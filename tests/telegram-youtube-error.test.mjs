import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBotFlow } from '../scripts/telegram-bot-flow.mjs';
import { telegramYouTubeError } from '../scripts/telegram-youtube-error.mjs';
import { inspectAccess } from '../lib/social-api.mjs';

const channel = { id: 12, platformName: 'YouTube', creatorTelegramId: '2001', status: 'active',
  url: 'https://youtube.com/@fixture', syncStatus: 'needs_auth', connectionStatus: 'needs_auth' };

async function card(syncError, fields = {}) {
  const sent = [];
  const flow = createTelegramBotFlow({ backend: async (action) => action === 'context' ? { canSubmit: true, role: 'creator' }
    : { channels: [{ ...channel, syncError, ...fields }] }, send: async (_, text, extra) => sent.push({ text, extra }),
  answerCallback: async () => {}, processLink: async () => {}, botUsername: () => 'fixture_bot' });
  await flow.handleMessage({ update_id: 1, message: { from: { id: 2001 }, chat: { id: 2001, type: 'private' }, text: '/channels' } });
  return sent[0];
}

test('the actual stored Google disabled-API error reaches the card with its concrete recovery step', async () => {
  let error;
  try {
    await inspectAccess(channel, { accessToken: 'synthetic-key-only' }, { fetchImpl: async () => Response.json({
      error: { errors: [{ reason: 'accessNotConfigured' }] },
    }, { status: 403 }) });
  } catch (caught) { error = caught; }
  assert.equal(error.syncStatus, 'needs_auth');
  const result = await card(error.message);
  assert.match(result.text, /Причина последней ошибки: YouTube Data API v3 выключен/);
  assert.match(result.text, /администратор сервиса/);
  assert.equal(result.extra.reply_markup.inline_keyboard[0][0].callback_data, 'social:connect:12');
});

test('legacy URLs, query values, Google keys and raw tokens never survive recognized or unknown errors', async () => {
  const googleKey = `AIza${'x'.repeat(35)}`;
  const opaqueToken = 'private-legacy-opaque-value-without-a-known-format';
  const legacy = `https://www.googleapis.com/youtube/v3/channels?key=${googleKey}&access_token=${opaqueToken} Authorization: Bearer ${opaqueToken}`;
  for (const prefix of ['YouTube Data API v3 выключен в проекте ключа.', 'API_KEY_IP_ADDRESS_BLOCKED', 'unrecognized legacy exception']) {
    const result = await card(`${prefix} ${legacy}`);
    assert.ok(!result.text.includes(googleKey));
    assert.ok(!result.text.includes(opaqueToken));
    assert.ok(!result.text.includes('googleapis.com'));
    assert.ok(!result.text.includes('Authorization:'));
    assert.ok(!result.text.includes('unrecognized legacy exception'));
    assert.match(result.text, /Причина последней ошибки:/);
  }
});

test('known failures stay specific, and quota does not ask to replace a working key', () => {
  const cases = [
    ['API_KEY_INVALID', /недействительный/],
    ['Ограничения YouTube API key блокируют сервер.', /ранее сохранённого ключа.*Google/],
    ['channelNotFound', /Изменить ссылку/],
    ['playlistNotFound', /каталог публичных загрузок/],
    ['YouTube: повтор страницы.', /Частичные суммы не публикуем/],
    ['Владелец API-доступа изменился.', /другой YouTube-аккаунт/],
  ];
  for (const [syncError, expected] of cases) assert.match(telegramYouTubeError({ ...channel, syncError }), expected);
  const quota = telegramYouTubeError({ ...channel, syncStatus: 'error', syncError: 'Лимит или временная ошибка API. Повторим автоматически.' });
  assert.match(quota, /квоту приложения должен проверить администратор/); assert.doesNotMatch(quota, /переподключ|новый ключ|действующий ключ/i);
});

test('only a current failed YouTube sync displays a reason; successful or pending cards ignore stale errors', () => {
  for (const fields of [{ platformName: 'Instagram' }, { syncStatus: 'success' }, { syncStatus: 'pending' }, { syncError: null }, { syncError: ' ' }]) {
    assert.equal(telegramYouTubeError({ ...channel, syncError: 'API_KEY_INVALID', ...fields }), null);
  }
});

test('revoked OAuth access suggests Google login, and an absent channel has no error', () => {
  assert.match(telegramYouTubeError({ ...channel, syncError: 'invalid_grant' }), /Войдите через Google/);
  assert.match(telegramYouTubeError({ ...channel, syncError: 'Вы вошли в другой YouTube-канал. Войдите через Google заново.' }), /выберите канал из добавленной ссылки/);
  assert.match(telegramYouTubeError({ ...channel, syncError: 'invalid_client' }), /администратор сервиса должен проверить приложение/);
  assert.equal(telegramYouTubeError(null), null);
  assert.equal(telegramYouTubeError(undefined), null);
});
