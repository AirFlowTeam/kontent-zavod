#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';

import {
  channelDescriptorsFromInfo,
  directChannelDescriptor,
  extractMessageUrl,
  inspectSubmittedUrl,
  parseTelegramAdminUserIds,
} from './telegram-bot-lib.mjs';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
const syncSecret = process.env.SYNC_SECRET ?? '';
const accessCode = process.env.TELEGRAM_ACCESS_CODE?.trim() ?? '';
const adminUserIds = parseTelegramAdminUserIds(process.env.TELEGRAM_ADMIN_USER_IDS);
const backendUrl = new URL(process.env.CONTENT_FACTORY_BASE_URL ?? 'http://127.0.0.1:18082');
const ytDlpBin = process.env.YTDLP_BIN?.trim() || '/usr/local/bin/yt-dlp';
const ytDlpTimeoutMs = Math.min(300_000, Math.max(30_000, Number(process.env.PARSER_TIMEOUT_SECONDS ?? 120) * 1_000));

if (!/^\d{6,15}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('TELEGRAM_BOT_TOKEN is missing or invalid');
if (!syncSecret) throw new Error('SYNC_SECRET is missing');
if (!/^[A-Za-z0-9_-]{12,64}$/.test(accessCode)) throw new Error('TELEGRAM_ACCESS_CODE is missing or invalid');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(backendUrl.hostname)) {
  throw new Error('CONTENT_FACTORY_BASE_URL must use a loopback host');
}
backendUrl.pathname = backendUrl.pathname.replace(/\/+$/, '');
backendUrl.search = '';
backendUrl.hash = '';

const botApiBase = `https://api.telegram.org/bot${token}`;
const stopController = new AbortController();
const authorizedUnboundUsers = new Set();
const recentSubmissions = new Map();
const activeChildren = new Set();
let stopping = false;

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
    if (status === 400 || status === 409 || status === 413 || status === 422) {
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

function creatorDescription(creator) {
  return `${creator.name} · ${creator.type} · продюсер ${creator.producerName}`;
}

function matchesAccessCode(candidate) {
  if (typeof candidate !== 'string') return false;
  const supplied = createHash('sha256').update(candidate).digest();
  const expected = createHash('sha256').update(accessCode).digest();
  return timingSafeEqual(supplied, expected);
}

function accessPrompt() {
  return 'Для первого входа нужна приглашательная ссылка или код доступа. Попросите их у администратора проекта.';
}

function hasSelectionAccess(telegramUserId) {
  const normalizedId = String(telegramUserId);
  return adminUserIds.has(normalizedId) || authorizedUnboundUsers.has(normalizedId);
}

async function sendMessage(chatId, text, extra = {}) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text: clipped(text, 4_000),
    disable_web_page_preview: true,
    ...extra,
  });
}

function chooserMarkup(creators, page) {
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(creators.length / pageSize));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  const start = safePage * pageSize;
  const rows = creators.slice(start, start + pageSize).map((creator) => [{
    text: clipped(`${creator.name} · ${creator.producerName}`, 58),
    callback_data: `creator:${creator.id}`,
  }]);
  if (pageCount > 1) {
    const navigation = [];
    if (safePage > 0) navigation.push({ text: '← Назад', callback_data: `page:${safePage - 1}` });
    navigation.push({ text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' });
    if (safePage < pageCount - 1) navigation.push({ text: 'Дальше →', callback_data: `page:${safePage + 1}` });
    rows.push(navigation);
  }
  return { inline_keyboard: rows };
}

async function contextFor(userId) {
  return backendRequest('context', { telegramUserId: String(userId) });
}

async function showChooser(chatId, userId, page = 0, messageId = null) {
  const context = await contextFor(userId);
  if (!context.creators.length) {
    const text = 'В платформе пока нет активных креаторов. Попросите продюсера сначала добавить вас в «Контент-завод».';
    if (messageId) {
      return telegramRequest('editMessageText', { chat_id: chatId, message_id: messageId, text });
    }
    return sendMessage(chatId, text);
  }
  const text = 'Выберите себя из списка. Это нужно сделать один раз. После выбора пришлите ссылку на канал или видео.';
  const reply_markup = chooserMarkup(context.creators, page);
  if (messageId) {
    return telegramRequest('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup,
    });
  }
  return sendMessage(chatId, text, { reply_markup });
}

function ytDlpEnvironment() {
  const allowed = [
    'PATH', 'LANG', 'LC_ALL', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME',
    'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  ];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
}

function readVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--ignore-config',
      '--no-plugin-dirs',
      '--no-cache-dir',
      '--dump-single-json',
      '--skip-download',
      '--no-playlist',
      '--socket-timeout', '30',
      '--retries', '2',
      '--quiet',
      '--no-warnings',
    ];
    const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
    const proxyUrl = process.env.PARSER_PROXY_URL?.trim();
    if (cookiesFile) args.push('--cookies', cookiesFile);
    if (proxyUrl) args.push('--proxy', proxyUrl);
    args.push('--', url);

    const child = spawn(ytDlpBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: ytDlpEnvironment(),
      windowsHide: true,
    });
    activeChildren.add(child);
    let stdout = '';
    let oversized = false;
    let timedOut = false;
    const outputLimit = 5 * 1024 * 1024;
    let forceKillTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      forceKillTimer.unref();
    }, ytDlpTimeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length + chunk.length > outputLimit) {
        oversized = true;
        child.kill('SIGTERM');
      } else stdout += chunk;
    });
    child.stderr.on('data', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      activeChildren.delete(child);
      reject(new ServiceError('Не удалось запустить распознавание ссылки', 500));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      activeChildren.delete(child);
      if (oversized) return reject(new ServiceError('Сервис вернул слишком большой ответ', 422, 0, true));
      if (code !== 0) {
        return reject(new ServiceError(
          timedOut || signal === 'SIGTERM'
            ? 'Распознавание заняло слишком много времени'
            : 'Не удалось определить автора по ролику',
          422, 0, true,
        ));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (!parsed || typeof parsed !== 'object') throw new Error('empty metadata');
        resolve(parsed);
      } catch {
        reject(new ServiceError('Не удалось определить автора по ролику', 422, 0, true));
      }
    });
  });
}

async function submitDescriptors(identity, updateId, sourceKind, descriptors) {
  let validationError = null;
  for (const item of descriptors) {
    try {
      return await backendRequest('submit', {
        telegramUserId: identity.telegramUserId,
        updateId,
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

async function processLink(chatId, user, updateId, url) {
  const inspected = inspectSubmittedUrl(url);
  if (!inspected.supported) {
    return sendMessage(chatId, inspected.reason === 'platform'
      ? 'Поддерживаются ссылки YouTube, RuTube, VK, TikTok и Instagram.'
      : 'Не вижу корректную ссылку. Пришлите её целиком, начиная с https://');
  }

  await sendMessage(chatId, inspected.needsResolution ? 'Определяю автора ролика…' : 'Проверяю канал…');
  let descriptors = inspected.candidates.map(directChannelDescriptor).filter(Boolean);
  if (inspected.needsResolution) {
    const metadata = await readVideoInfo(url);
    descriptors = channelDescriptorsFromInfo(metadata, url);
  }
  if (!descriptors.length) {
    throw new ServiceError('Не удалось определить автора по ролику. Пришлите ссылку на сам канал.', 422, 0, true);
  }
  const result = await submitDescriptors(userIdentity(user), updateId, inspected.sourceKind, descriptors);
  const channel = result.channel;
  if (channel.status === 'inactive') {
    return sendMessage(chatId, channel.creatorMatch
      ? `⚠️ Этот канал уже есть, но отключён. Попросите администратора включить его снова.\n${channel.normalizedUrl}`
      : `⚠️ Этот канал уже есть в платформе, но отключён. Ничего не менял.\n${channel.normalizedUrl}`);
  }
  if (channel.resultStatus === 'created') {
    return sendMessage(chatId, `✅ Канал добавлен к «${channel.creatorName}»\n${channel.normalizedUrl}\n\nСтатистика будет собираться и обновляться автоматически.`);
  }
  if (channel.creatorMatch) {
    return sendMessage(chatId, `✅ Этот канал уже привязан к «${channel.creatorName}»\n${channel.normalizedUrl}\n\nПовторно добавлять его не нужно.`);
  }
  return sendMessage(chatId, `⚠️ Этот канал уже привязан к другому креатору. Ничего не менял.\n${channel.normalizedUrl}`);
}

async function handleCommand(message, command, payload = '') {
  const chatId = message.chat.id;
  const identity = userIdentity(message.from);
  if (command === 'change') {
    const context = await contextFor(identity.telegramUserId);
    if (context.binding || hasSelectionAccess(identity.telegramUserId)) {
      return showChooser(chatId, identity.telegramUserId);
    }
    return sendMessage(chatId, accessPrompt());
  }
  if (command === 'whoami') {
    const context = await contextFor(identity.telegramUserId);
    return sendMessage(chatId, context.binding
      ? `Вы привязаны как: ${creatorDescription(context.binding)}\n\nЧтобы изменить привязку: /change`
      : 'Вы пока не привязаны к креатору. Нажмите /start и выберите себя.');
  }
  if (command === 'help') {
    return sendMessage(chatId,
      'Как пользоваться:\n1. Выберите себя через /start.\n2. Пришлите ссылку на свой канал или на любое своё видео.\n3. Бот определит канал, добавит его в платформу и запустит автообновление статистики.\n\nПоддерживаются YouTube, RuTube, VK, TikTok и Instagram. Отдельные ролики не сохраняются.');
  }
  const context = await contextFor(identity.telegramUserId);
  if (!context.binding) {
    if (matchesAccessCode(payload)) authorizedUnboundUsers.add(identity.telegramUserId);
    if (hasSelectionAccess(identity.telegramUserId)) return showChooser(chatId, identity.telegramUserId);
    return sendMessage(chatId, accessPrompt());
  }
  return sendMessage(chatId,
    `Привет! Вы привязаны как: ${creatorDescription(context.binding)}\n\nПросто пришлите ссылку на свой канал или любое своё видео. Изменить привязку: /change`);
}

async function handleMessage(update) {
  const message = update.message;
  if (!message?.from || message.chat?.type !== 'private') return;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const commandMatch = text.match(/^\/(start|help|whoami|change)(?:@\w+)?(?:\s+([^\s]+))?\s*$/i);
  if (commandMatch) return handleCommand(message, commandMatch[1].toLowerCase(), commandMatch[2] ?? '');
  if (text.startsWith('/')) return sendMessage(message.chat.id, 'Неизвестная команда. Нажмите /help.');

  const url = extractMessageUrl(message);
  if (!url) {
    return sendMessage(message.chat.id, 'Пришлите ссылку на свой канал или видео. Если нужна подсказка — /help.');
  }
  const identity = userIdentity(message.from);
  const context = await contextFor(identity.telegramUserId);
  if (!context.binding) {
    if (hasSelectionAccess(identity.telegramUserId)) return showChooser(message.chat.id, identity.telegramUserId);
    return sendMessage(message.chat.id, accessPrompt());
  }
  const previous = recentSubmissions.get(identity.telegramUserId);
  if (previous && previous.updateId !== update.update_id && Date.now() - previous.at < 5_000) {
    return sendMessage(message.chat.id, 'Подождите несколько секунд перед следующей ссылкой.');
  }
  recentSubmissions.set(identity.telegramUserId, { updateId: update.update_id, at: Date.now() });
  if (recentSubmissions.size > 2_000) recentSubmissions.delete(recentSubmissions.keys().next().value);
  return processLink(message.chat.id, message.from, update.update_id, url);
}

async function answerCallback(callbackQueryId, text = '') {
  try {
    await telegramRequest('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false });
  } catch {
    // A stale callback notification must not block the actual action.
  }
}

async function handleCallback(update) {
  const callback = update.callback_query;
  if (!callback?.id) return;
  await answerCallback(callback.id);
  const message = callback?.message;
  if (!callback?.from || !message || message.chat?.type !== 'private') return;
  const data = typeof callback.data === 'string' ? callback.data : '';
  if (data === 'noop') return;
  const identity = userIdentity(callback.from);
  const current = await contextFor(identity.telegramUserId);
  if (!current.binding && !hasSelectionAccess(identity.telegramUserId)) {
    await sendMessage(message.chat.id, accessPrompt());
    return;
  }
  const pageMatch = data.match(/^page:(\d+)$/);
  if (pageMatch) {
    return showChooser(message.chat.id, callback.from.id, Number(pageMatch[1]), message.message_id);
  }
  const creatorMatch = data.match(/^creator:(\d+)$/);
  if (!creatorMatch) return;
  const result = await backendRequest('bind', {
    ...identity,
    chatId: String(message.chat.id),
    creatorId: Number(creatorMatch[1]),
  });
  await telegramRequest('editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: `✅ Готово. Вы: ${creatorDescription(result.binding)}\n\nТеперь пришлите ссылку на свой канал или видео.`,
  });
  authorizedUnboundUsers.delete(identity.telegramUserId);
}

async function handleUpdate(update) {
  try {
    if (update.message) await handleMessage(update);
    else if (update.callback_query) await handleCallback(update);
  } catch (error) {
    if (stopping) return;
    const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    const known = error instanceof ServiceError;
    const userMessage = known && error.userSafe
      ? error.message
      : 'Не удалось обработать ссылку. Попробуйте ещё раз чуть позже.';
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
    const timer = setTimeout(resolve, ms);
    stopController.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  stopController.abort();
  for (const child of activeChildren) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of activeChildren) child.kill('SIGKILL');
  }, 5_000).unref();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function main() {
  const me = await telegramRequest('getMe');
  await telegramRequest('deleteWebhook', { drop_pending_updates: false });
  await telegramRequest('setMyCommands', {
    commands: [
      { command: 'start', description: 'Начать и выбрать себя' },
      { command: 'whoami', description: 'Показать текущую привязку' },
      { command: 'change', description: 'Изменить креатора' },
      { command: 'help', description: 'Как пользоваться ботом' },
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
      failures = 0;
      for (const update of updates) {
        if (!Number.isSafeInteger(update.update_id)) continue;
        await handleUpdate(update);
        offset = Math.max(offset, update.update_id + 1);
        if (stopping) break;
      }
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
