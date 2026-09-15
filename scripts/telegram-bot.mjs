#!/usr/bin/env node

import { createTelegramBotFlow, homeMenu } from './telegram-bot-flow.mjs';
import { runYtDlp } from './yt-dlp-runner.mjs';

import {
  channelDescriptorsFromInfo,
  directChannelDescriptor,
  inspectSubmittedUrl,
  normalizeVkSourceUrl,
  parseTelegramAdminUserIds,
} from './telegram-bot-lib.mjs';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
const syncSecret = process.env.SYNC_SECRET ?? '';
const adminUserIds = parseTelegramAdminUserIds(process.env.TELEGRAM_ADMIN_USER_IDS);
const backendUrl = new URL(process.env.CONTENT_FACTORY_BASE_URL ?? 'http://127.0.0.1:18082');
const ytDlpBin = process.env.YTDLP_BIN?.trim() || '/usr/local/bin/yt-dlp';
const ytDlpTimeoutMs = Math.min(300_000, Math.max(30_000, Number(process.env.PARSER_TIMEOUT_SECONDS ?? 120) * 1_000));

if (!/^\d{6,15}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('TELEGRAM_BOT_TOKEN is missing or invalid');
if (!syncSecret) throw new Error('SYNC_SECRET is missing');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(backendUrl.hostname)) {
  throw new Error('CONTENT_FACTORY_BASE_URL must use a loopback host');
}
backendUrl.pathname = backendUrl.pathname.replace(/\/+$/, '');
backendUrl.search = '';
backendUrl.hash = '';

const botApiBase = `https://api.telegram.org/bot${token}`;
const stopController = new AbortController();
let stopping = false;
let botUsername = '';
const flow = createTelegramBotFlow({ backend: backendRequest, send: sendMessage,
  answerCallback, processLink, botUsername: () => botUsername });

class ServiceError extends Error {
  constructor(message, status = 500, retryAfter = 0, userSafe = false) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.userSafe = userSafe;
  }
}

function combinedSignal(timeoutMs) {
  return AbortSignal.any([stopController.signal, AbortSignal.timeout(timeoutMs)]);
}

async function telegramRequest(method, payload = {}, timeoutMs = 20_000) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetch(`${botApiBase}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: combinedSignal(timeoutMs),
      });
    } catch (error) {
      if (stopping) throw error;
      throw new ServiceError('Telegram временно недоступен', 503);
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new ServiceError('Telegram временно недоступен', 503);
    }
    if (response.ok && result?.ok) return result.result;
    const description = typeof result?.description === 'string' ? result.description : '';
    if (method === 'editMessageText' && /message is not modified/i.test(description)) return true;
    const status = response.status || result?.error_code || 502;
    const retryAfter = Math.max(1, Math.min(60, Number(result?.parameters?.retry_after ?? 0) || 1));
    if (status === 429 && attempt < 2) {
      await wait(retryAfter * 1_000);
      continue;
    }
    throw new ServiceError('Telegram временно недоступен', 503, status === 429 ? retryAfter : 0);
  }
  throw new ServiceError('Telegram временно недоступен', 503);
}

async function backendRequest(action, fields) {
  let response;
  try {
    response = await fetch(new URL('/api/telegram', backendUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sync-secret': syncSecret,
      },
      body: JSON.stringify({ action, ...fields }),
      signal: combinedSignal(20_000),
    });
  } catch (error) {
    if (stopping) throw error;
    throw new ServiceError('Платформа временно недоступна', 503);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new ServiceError('Платформа вернула некорректный ответ', 502);
  }
  if (!response.ok || !result?.ok) {
    const status = response.status || 500;
    const publicError = typeof result?.error === 'string' ? result.error : 'Ошибка платформы';
    if ([400, 403, 404, 409, 410, 413, 422].includes(status)) {
      throw new ServiceError(publicError, status, 0, true);
    }
    throw new ServiceError('Платформа временно недоступна', 503);
  }
  return result;
}

function clipped(value, maxLength) {
  const text = String(value ?? '').trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function userIdentity(user) {
  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  return {
    telegramUserId: String(user.id),
    username: typeof user?.username === 'string' ? user.username : null,
    displayName: displayName || null,
  };
}


async function sendMessage(chatId, text, extra = {}) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text: clipped(text, 4_000),
    disable_web_page_preview: true,
    ...homeMenu,
    ...extra,
  });
}



async function submitDescriptors(identity, updateId, sourceKind, descriptors, itemIndex) {
  let validationError = null;
  for (const item of descriptors) {
    try {
      return await backendRequest('submit', {
        telegramUserId: identity.telegramUserId,
        updateId,
        itemIndex,
        sourceKind,
        channelUrl: item.url,
        providerChannelId: item.providerChannelId ?? null,
        handle: item.handle ?? null,
      });
    } catch (error) {
      if (error instanceof ServiceError && error.status === 400) {
        validationError = error;
        continue;
      }
      throw error;
    }
  }
  throw validationError ?? new ServiceError('Не удалось определить канал по этой ссылке', 422, 0, true);
}

async function processLink(chatId, user, updateId, url, itemIndex = 0) {
  const inspected = inspectSubmittedUrl(url);
  if (!inspected.supported) {
    return sendMessage(chatId, inspected.reason === 'platform'
      ? `Ссылка ${itemIndex + 1} не добавлена. Поддерживаются YouTube, RuTube, VK, TikTok, Instagram и Threads. Пришлите полный адрес своего профиля.`
      : 'Не вижу корректную ссылку. Пришлите её целиком, начиная с https://');
  }

  await sendMessage(chatId, inspected.needsResolution ? 'Определяю автора ролика…' : 'Проверяю канал…');
  let descriptors = inspected.candidates.map(directChannelDescriptor).filter(Boolean);
  if (inspected.needsResolution) {
    const metadata = await runYtDlp(normalizeVkSourceUrl(url), { binary: ytDlpBin, timeoutMs: ytDlpTimeoutMs, video: true,
      cookieFile: process.env.YTDLP_COOKIES_FILE, proxyUrl: process.env.PARSER_PROXY_URL, signal: stopController.signal })
      .catch(() => { throw new ServiceError('Не удалось определить автора по ролику. Пришлите ссылку на канал.', 422, 0, true); });
    descriptors = channelDescriptorsFromInfo(metadata, url);
  }
  if (!descriptors.length) {
    throw new ServiceError('Не удалось определить автора по ролику. Пришлите ссылку на сам канал.', 422, 0, true);
  }
  const result = await submitDescriptors(userIdentity(user), updateId, inspected.sourceKind, descriptors, itemIndex);
  const channel = result.channel;
  const nextSteps = { reply_markup: { inline_keyboard: [
    ...(channel.creatorMatch && channel.platformName !== 'RuTube' ? [[{ text: `Подключить мой ${channel.platformName}`, callback_data: `social:connect:${channel.id}` }], [{ text: 'Как получить доступ · пошагово', callback_data: `social:help:${channel.platformName}` }]] : []),
    [{ text: '＋ Добавить ещё ссылки', callback_data: 'menu:add-channel' }],
    [{ text: 'Мои каналы', callback_data: 'menu:channels' }],
  ] } };
  if (channel.status === 'deleted') return sendMessage(chatId, 'Этот канал был удалён. Повтор старого действия ничего не изменил. Чтобы добавить его снова, отправьте ссылку новым сообщением.');
  if (channel.status === 'inactive') {
    return sendMessage(chatId, channel.creatorMatch
      ? `⚠️ Этот канал уже есть, но сбор приостановлен. Откройте «Мои каналы» → «Возобновить сбор».\n${channel.normalizedUrl}`
      : `⚠️ Этот канал уже есть в платформе, но отключён. Ничего не менял.\n${channel.normalizedUrl}`);
  }
  if (channel.resultStatus === 'created') {
    return sendMessage(chatId, `✅ Канал добавлен к «${channel.creatorName}»\n${channel.normalizedUrl}\n\n${channel.platformName === 'RuTube' ? 'Ключ не нужен: первая проверка уже в очереди.' : 'Шаг 4 — подключите личный доступ кнопкой ниже. Для этого канала ключи вводите только вы, не продюсер.'}\nПоказатели обновляются раз в сутки. Можно прислать следующий канал.`, nextSteps);
  }
  if (channel.creatorMatch) {
    return sendMessage(chatId, `✅ Этот канал уже привязан к «${channel.creatorName}»\n${channel.normalizedUrl}\n\nПовторно добавлять его не нужно. Можно проверить доступ или добавить другие ссылки.`, nextSteps);
  }
  return sendMessage(chatId, `⚠️ Этот канал уже привязан к другому креатору. Ничего не менял.\n${channel.normalizedUrl}`);
}


async function answerCallback(callbackQueryId, text = '') {
  try {
    await telegramRequest('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false });
  } catch {
    // A stale callback notification must not block the actual action.
  }
}


async function handleUpdate(update) {
  try {
    if (update.message) await flow.handleMessage(update);
    else if (update.callback_query) await flow.handleCallback(update);
  } catch (error) {
    if (stopping) return;
    const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    const known = error instanceof ServiceError;
    const userMessage = known && error.userSafe
      ? error.message
      : 'Не удалось выполнить действие. Попробуйте ещё раз чуть позже или вернитесь в главное меню.';
    if (chatId) {
      try {
        await sendMessage(chatId, `${userMessage}${known && error.status === 422 ? '\n\nМожно сразу прислать ссылку на канал.' : ''}`);
      } catch {
        // The polling loop stays alive even when the reply itself cannot be delivered.
      }
    }
    console.error(JSON.stringify({ message: 'telegram update failed', status: known ? error.status : 500 }));
    if (!known || error.status >= 500) throw error;
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      stopController.signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (stopController.signal.aborted) finish();
    else stopController.signal.addEventListener('abort', finish, { once: true });
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  stopController.abort();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function main() {
  const me = await telegramRequest('getMe');
  botUsername = me.username;
  await telegramRequest('deleteWebhook', { drop_pending_updates: false });
  await telegramRequest('setMyCommands', {
    commands: [
      { command: 'start', description: 'Начать работу' },
      { command: 'profile', description: 'Мой профиль и продюсер' },
      { command: 'creators', description: 'Мои креаторы' },
      { command: 'invite', description: 'Добавить креатора' },
      { command: 'channels', description: 'Каналы и статистика' },
      { command: 'role', description: 'Моя роль' },
      { command: 'help', description: 'Как пользоваться ботом' },
      { command: 'social', description: 'API и инструкции всех соцсетей' },
      { command: 'guide', description: 'Пошагово: от приглашения до каналов' },
      { command: 'api', description: 'Подключить мой доступ к соцсетям' },
    ],
    scope: { type: 'all_private_chats' },
  });
  console.log(JSON.stringify({
    message: 'telegram bot started',
    username: me.username ?? null,
    adminAccessCount: adminUserIds.size,
  }));

  let offset = 0;
  let failures = 0;
  while (!stopping) {
    try {
      const updates = await telegramRequest('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query'],
      }, 35_000);
      for (const update of updates) {
        if (!Number.isSafeInteger(update.update_id)) continue;
        await handleUpdate(update);
        offset = Math.max(offset, update.update_id + 1);
        if (stopping) break;
      }
      failures = 0;
    } catch (error) {
      if (stopping) break;
      failures += 1;
      const retryAfter = error instanceof ServiceError ? error.retryAfter * 1_000 : 0;
      const backoff = retryAfter || Math.min(30_000, 1_000 * (2 ** Math.min(failures - 1, 5)));
      console.error(JSON.stringify({
        message: 'telegram polling retry',
        status: error instanceof ServiceError ? error.status : 500,
        retryInMs: backoff,
      }));
      await wait(backoff);
    }
  }
  console.log(JSON.stringify({ message: 'telegram bot stopped' }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    message: 'telegram bot failed to start',
    status: error instanceof ServiceError ? error.status : 500,
  }));
  process.exitCode = 1;
});
