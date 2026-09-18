import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';
import { inspectSubmittedUrl, directChannelDescriptor } from '../scripts/telegram-bot-lib.mjs';

async function setup(t) {
  const h = storageHarness(); t.after(h.close); const onboarding = await onboard(h);
  const post = h.load('app/api/telegram/route.ts').POST, sent = [], handled = [];
  const backend = async (action, fields) => {
    const r = await post(new Request('http://localhost/api/telegram', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': h.env.SYNC_SECRET }, body: JSON.stringify({ action, ...fields }) }));
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.error), { status: r.status, userSafe: r.status < 500 });
    return data;
  };
  const flow = createTelegramBotFlow({ backend, send: async (_id, text, extra) => sent.push({ text, extra }), botUsername: () => 'fixture_bot', answerCallback: async () => {},
    processLink: async (_chat, user, updateId, url, itemIndex) => {
      handled.push({ url, itemIndex });
      const inspected = inspectSubmittedUrl(url);
      if (!inspected.supported) throw Object.assign(new Error('Площадка не поддерживается'), { status: 422, userSafe: true });
      const descriptor = directChannelDescriptor(inspected.candidates[0]);
      return backend('submit', { telegramUserId: String(user.id), updateId, itemIndex, channelUrl: descriptor.url, handle: descriptor.handle, sourceKind: inspected.sourceKind });
    } });
  const message = (text, update_id = 100) => flow.handleMessage({ update_id, message: { from: { id: 2001 }, chat: { id: 2001, type: 'private' }, text } });
  const callback = (data, id = 2001) => flow.handleCallback({ update_id: 200, callback_query: { id: '200', from: { id }, message: { chat: { id, type: 'private' } }, data } });
  return { h, ...onboarding, sent, handled, backend, message, callback };
}

test('mixed bulk saves each valid link, stable indices, duplicate message and alias do not create duplicates', async (t) => {
  const { h, message, handled, sent } = await setup(t);
  const text = 'https://youtube.com/@alice\nhttps://unsupported.example/profile\nhttps://threads.net/@alice/post/ABC\nhttps://vk.ru/club123';
  await message(text); await message(text);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creator_channels').get().n, 3);
  assert.deepEqual(h.sqlite.prepare('SELECT item_index FROM telegram_submissions ORDER BY item_index').all().map((v) => v.item_index), [0, 2, 3]);
  assert.deepEqual(handled.map((v) => v.itemIndex), [0, 1, 2, 3, 0, 1, 2, 3]);
  assert.ok(sent.some((s) => /Ссылка 2 не добавлена/.test(s.text)));
  await message('https://threads.com/@alice\nhttps://vk.com/club123', 101);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creator_channels').get().n, 3);
});

test('limit, duplicate URLs and legacy item index zero are explicit and bounded', async (t) => {
  const { h, message, sent, handled } = await setup(t);
  await message(Array.from({ length: 11 }, (_, i) => `https://youtube.com/@person${i}`).join('\n'));
  assert.equal(handled.length, 0); assert.match(sent.at(-1).text, /пока ничего не добавлено/);
  await message('https://youtube.com/@alice\nhttps://youtube.com/@alice');
  assert.equal(handled.length, 1);
  const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const replay = await submit({ telegramUserId: '2001', updateId: 100, channelUrl: 'https://youtube.com/@alice', sourceKind: 'channel' });
  assert.equal(replay.idempotent, true);
  for (const itemIndex of [-1, 10, 0.5, '0', null]) await assert.rejects(submit({ telegramUserId: '2001', updateId: 101, itemIndex, sourceKind: 'channel', channelUrl: 'https://youtube.com/@other' }), /номер ссылки/);
});

test('guide has working steps, saved-state navigation and API options only for own creator channels', async (t) => {
  const { h, message, callback, sent } = await setup(t);
  await callback('menu:add-channel'); assert.match(sent.at(-1).text, /Какая соцсеть/);
  assert.ok(sent.at(-1).extra.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'guide:link:Threads:0'));
  await callback('guide:link:Threads:0'); assert.match(sent.at(-1).text, /Копировать ссылку/);
  await callback('guide:link:Threads:1'); assert.match(sent.at(-1).text, /Вставьте ссылку/);
  await message('https://threads.net/@alice');
  await message('/api'); assert.match(sent.at(-1).text, /нужно подключить аккаунт/);
  assert.ok(sent.at(-1).extra.reply_markup.inline_keyboard.flat().some((b) => b.callback_data?.startsWith('social:connect:')));
  await callback('social:help:Threads'); assert.match(sent.at(-1).text, /шаг 1 из/);
  await callback('social:help:Threads:1'); assert.match(sent.at(-1).text, /администратор/);
  await callback('social:help:Threads:2'); assert.match(sent.at(-1).text, /Войти через Threads/);
  await callback('connections:Threads', 1001); assert.match(sent.at(-1).text, /контент/);
  assert.ok(!sent.at(-1).extra.reply_markup.inline_keyboard.flat().some((b) => b.callback_data?.startsWith('social:connect:')));
  await message('/channels'); assert.ok(sent.some((s) => /Посты: не получено/.test(s.text)));
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM social_connect_tickets').get().n, 0);
});

test('simultaneous duplicate receipt cannot enrich two channels; capability removal at final batch prevents creation', async (t) => {
  const { h } = await setup(t); const submit = h.load('db/telegram.ts').submitTelegramChannel;
  const base = { telegramUserId: '2001', sourceKind: 'channel' };
  await submit({ ...base, updateId: 1, channelUrl: 'https://youtube.com/@one' });
  await submit({ ...base, updateId: 2, channelUrl: 'https://youtube.com/@two' });
  const results = await Promise.all([
    submit({ ...base, updateId: 3, channelUrl: 'https://youtube.com/@one', providerChannelId: 'first-provider' }),
    submit({ ...base, updateId: 3, channelUrl: 'https://youtube.com/@two', providerChannelId: 'second-provider' }),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creator_channels WHERE provider_channel_id IS NOT NULL').get().n, 1);
  const batch = h.DB.batch.bind(h.DB);
  h.DB.batch = async (items) => { h.sqlite.prepare("UPDATE telegram_creator_links SET type_confirmed_at=NULL WHERE telegram_user_id='2001'").run(); return batch(items); };
  await assert.rejects(submit({ ...base, updateId: 4, channelUrl: 'https://youtube.com/@new' }), /изменены/);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM creator_channels').get().n, 2);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM telegram_submissions WHERE update_id=4').get().n, 0);
});
