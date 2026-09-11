import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSubmittedUrl, directChannelDescriptor, channelDescriptorsFromInfo, normalizeVkSourceUrl } from '../scripts/telegram-bot-lib.mjs';
import { storageHarness, onboard } from './storage-harness.mjs';

test('VK .ru aliases work in bot, server and platform detection without changing stored domain configuration', (t) => {
  const h = storageHarness(); t.after(h.close);
  const { normalizeChannelUrl } = h.load('db/storage.ts');
  const { detectPlatformId } = h.load('lib/content-metrics.ts');
  const platforms = [{ id: 4, name: 'VK', domains: ['vk.com', 'vkvideo.ru'] }];
  for (const host of ['vk.ru', 'm.vk.ru', 'www.vk.ru', 'VK.RU', 'vk.com']) {
    for (const path of ['club241403852', 'public241403852', 'id241403852', 'creator.name']) {
      const url = `https://${host}/${path}/?utm_source=telegram`;
      const canonical = `https://vk.com/${path}`;
      const inspected = inspectSubmittedUrl(url);
      assert.equal(inspected.supported, true);
      assert.equal(inspected.needsResolution, false);
      assert.deepEqual(inspected.candidates, [canonical]);
      assert.equal(directChannelDescriptor(url).url, canonical);
      assert.equal(normalizeChannelUrl(url).normalizedUrl, canonical);
      assert.equal(detectPlatformId(url, platforms), 4);
    }
  }
  assert.equal(directChannelDescriptor('https://vk.ru/club241403852').providerChannelId, '-241403852');
  for (const url of ['https://vk.ru.evil.example/club1', 'https://fakevk.ru/club1', 'https://user@vk.ru/club1']) {
    assert.equal(inspectSubmittedUrl(url).supported, false);
    assert.throws(() => normalizeChannelUrl(url));
  }
});

test('VK .ru video links retain their path/query for resolution and cannot be stored as channels', (t) => {
  const h = storageHarness(); t.after(h.close);
  const { normalizeChannelUrl, normalizeUrl } = h.load('db/storage.ts');
  for (const suffix of ['/video-241403852_456239001', '/clip-241403852_456239001', '/club241403852?z=video-241403852_456239001%2Fpl_-241403852_-2']) {
    const url = `https://m.vk.ru${suffix}`;
    assert.equal(inspectSubmittedUrl(url).needsResolution, true);
    assert.equal(inspectSubmittedUrl(url).sourceKind, 'video');
    assert.equal(normalizeVkSourceUrl(url), `https://vk.com${suffix}`);
    assert.throws(() => normalizeChannelUrl(url));
    assert.deepEqual(channelDescriptorsFromInfo({ uploader_id: '-241403852' }, url), [{ url: 'https://vk.com/club241403852', providerChannelId: '-241403852', handle: null }]);
  }
  assert.equal(normalizeUrl('https://vk.ru/video-1_2?utm_source=tg'), 'https://vk.com/video-1_2');
  assert.equal(normalizeVkSourceUrl('https://youtube.com/watch?v=123'), 'https://youtube.com/watch?v=123');
  assert.equal(normalizeVkSourceUrl('https://vk.ru.evil.example/video-1_2'), 'https://vk.ru.evil.example/video-1_2');
});

test('VK .ru and .com submissions share one channel and cannot transfer another creator’s ownership', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const { context } = await onboard(h);
  await onboard(h, { producerId: '1002', creatorId: '2002' });
  const { submitTelegramChannel } = h.load('db/telegram.ts');
  const base = { telegramUserId: '2001', sourceKind: 'channel' };
  const first = await submitTelegramChannel({ ...base, updateId: 1, channelUrl: 'https://vk.ru/club241403852' });
  const duplicate = await submitTelegramChannel({ ...base, updateId: 2, channelUrl: 'https://vk.com/club241403852' });
  assert.equal(first.id, duplicate.id);
  assert.equal(first.resultStatus, 'created');
  assert.equal(duplicate.resultStatus, 'existing');
  const other = await submitTelegramChannel({ ...base, telegramUserId: '2002', updateId: 3, channelUrl: 'https://www.vk.ru/club241403852' });
  assert.equal(other.creatorMatch, false);
  assert.equal(other.creatorName, null);
  const saved = h.sqlite.prepare('SELECT creator_id, normalized_url FROM creator_channels').all();
  assert.deepEqual(saved.map((row) => ({ ...row })), [{ creator_id: context.binding.id, normalized_url: 'https://vk.com/club241403852' }]);
  const { createChannel } = h.load('db/storage.ts');
  await assert.rejects(createChannel({ creatorId: context.binding.id, url: 'https://m.vk.ru/club241403852' }), /UNIQUE constraint/);
});
