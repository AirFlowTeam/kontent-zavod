import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';

// UI contracts only: bootstrap, ownership and atomic writes are exercised by
// backend tests. The ordinary producer deliberately has no admin/dual flag.
const own = { id: 12, creatorTelegramId: '2001', creatorName: 'Fixture', platformName: 'YouTube',
  url: 'https://youtube.com/@own', status: 'active', syncStatus: 'needs_auth', connectionStatus: null };
const binding = { id: 7, name: 'Fixture', type: 'UGC', typeConfirmedAt: '2026-09-17',
  creatorStatus: 'active', producerStatus: 'active', producerTelegramId: '1001' };

function conversation(role, ready = true) {
  let context = { role, dualRole: false, isAdmin: false, canProduce: role === 'producer', canSubmit: ready,
    selectedType: ready ? 'UGC' : null, pendingInvite: null, producer: role === 'producer' ? { id: 8, name: 'Own team', status: 'active' } : null,
    binding: ready ? binding : null, creators: [] };
  const calls = [], sent = [], submissions = [];
  const flow = createTelegramBotFlow({ backend: async (action, fields) => {
    calls.push({ action, fields });
    if (action === 'context') return context;
    if (action === 'selectType') return context = { ...context, selectedType: fields.type, canSubmit: true, binding: { ...binding, type: fields.type } };
    if (action === 'channels') return { channels: ready ? [{ ...own, ...(fields.scope === 'team' ? { id: 99, creatorTelegramId: '9999', url: 'https://youtube.com/@teammate' } : {}) }] : [] };
    if (action === 'journey') return { journey: {}, setup: [{ platformName: 'YouTube', available: true }] };
    throw new Error(`Unexpected action ${action}`);
  }, send: async (_, text, extra) => sent.push({ text, extra }), answerCallback: async () => {}, botUsername: () => 'fixture_bot',
  processLink: async (...args) => { submissions.push(args); return { channel: { ...own, creatorMatch: true, resultStatus: 'created' } }; } });
  const message = (text) => flow.handleMessage({ update_id: 1, message: { from: { id: 2001 }, chat: { id: 2001, type: 'private' }, text } });
  const callback = (data) => flow.handleCallback({ update_id: 2, callback_query: { id: '2', from: { id: 2001 }, message: { chat: { id: 2001, type: 'private' } }, data } });
  return { calls, sent, submissions, message, callback };
}

test('either chosen role may select content type without an invitation or admin capability', async () => {
  for (const role of ['producer', 'creator']) {
    const c = conversation(role, false);
    await c.callback('type:UGC');
    const selected = c.calls.filter((call) => call.action === 'selectType');
    assert.equal(selected.length, 1, `${role} must reach backend selectType`);
    assert.equal(selected[0].fields.telegramUserId, '2001');
    assert.equal(selected[0].fields.type, 'UGC');
    assert.equal(c.calls.some((call) => call.action.startsWith('admin')), false);
    assert.equal(c.calls.some((call) => call.action === 'acceptInvite'), false);
  }
});

test('an ordinary producer with canSubmit uses own API channels and can submit a personal URL', async () => {
  const c = conversation('producer');
  await c.message('/api');
  assert.ok(c.calls.some((call) => call.action === 'channels' && call.fields.scope === 'own'));
  assert.doesNotMatch(c.sent.at(-1).text, /API подключают сами креаторы/);
  await c.message('https://youtube.com/@new-own');
  assert.equal(c.submissions.length, 1);
  assert.equal(c.submissions[0][1].id, 2001);
  assert.equal(c.calls.some((call) => call.action === 'role'), false);
  assert.equal(c.calls.some((call) => call.action.startsWith('admin')), false);
});

test('a personal capability never turns a producer team card into a teammate credential control', async () => {
  const c = conversation('producer');
  await c.callback('menu:team-channels');
  assert.ok(c.calls.some((call) => call.action === 'channels' && call.fields.scope === 'team'));
  const callbacks = c.sent.flatMap((item) => item.extra?.reply_markup?.inline_keyboard?.flat() || []).map((button) => button.callback_data || '');
  assert.equal(callbacks.some((data) => /^social:(connect|personal|disconnect):99$/.test(data)), false);
  assert.equal(callbacks.some((data) => /^channel:(edit|delete|settings|pause|resume):99$/.test(data)), false);
});
