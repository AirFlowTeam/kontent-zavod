#!/usr/bin/env node

import { runYtDlp } from './yt-dlp-runner.mjs';
import { ensureMetrics, mapYtDlpResult, ytDlpChannelUrl, classifyProviderError } from './channel-parser-lib.mjs';
import { fetchPublicProfile, parseVkProfile } from './channel-providers.mjs';
import { parseRutubeProfile } from './rutube-provider.mjs';
import { collectAuthorized, refreshAccess, SocialApiError } from '../lib/social-api.mjs';

const baseUrl = (process.env.CONTENT_FACTORY_BASE_URL || 'http://127.0.0.1:18082').replace(
  /\/$/,
  '',
);
const syncSecret = process.env.SYNC_SECRET;
const ytDlpBin = process.env.YTDLP_BIN || '/usr/local/bin/yt-dlp';
const pollIntervalMs = Math.max(10, Number(process.env.SYNC_POLL_SECONDS) || 45) * 1_000;
const commandTimeoutMs = Math.max(60, Number(process.env.PARSER_TIMEOUT_SECONDS) || 180) * 1_000;
const playlistLimit = Math.max(10, Number(process.env.PARSER_PLAYLIST_LIMIT) || 120);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname)) throw new Error('Collector backend must be loopback');

if (!syncSecret) {
  throw new Error('SYNC_SECRET is required');
}

let stopping = false;
const stopController = new AbortController();

function requestStop() {
  if (stopping) return;
  stopping = true;
  stopController.abort();
}

process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);

function requestSignal(timeoutMs) {
  return AbortSignal.any([stopController.signal, AbortSignal.timeout(timeoutMs)]);
}

function wait(ms) {
  if (stopping) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      stopController.signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    stopController.signal.addEventListener('abort', finish, { once: true });
  });
}

function compactError(value) {
  return String(value || 'Неизвестная ошибка')
    .replace(/https?:\/\/[^\s]+/g, '[provider URL]')
    .replace(/(?:access_token|refresh_token|client_secret|authorization|api_key|key)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

async function syncRequest(body) {
  const response = await fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sync-secret': syncSecret,
    },
    body: JSON.stringify(body),
    signal: requestSignal(30_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Sync API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (body.action === 'claim' ? !Array.isArray(payload.channels) : payload.ok !== true) {
    throw new Error('Sync API вернул неподтверждённый результат');
  }
  return payload;
}

async function reportResult(payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await syncRequest(payload); }
    catch (error) {
      if (stopping || attempt === 2 || (error.status && error.status < 500 && error.status !== 429)) throw error;
      await wait(1000 * (2 ** attempt));
    }
  }
}


async function parseRutubePublicProfile(channel) {
  if (channel.platformName !== 'RuTube') return null;
  const match = new URL(channel.url).pathname.match(/\/(?:channel|video\/person)\/(\d+)/i);
  let profileId = /^\d+$/.test(channel.providerChannelId || '') ? channel.providerChannelId : match?.[1];
  if (!profileId && new URL(channel.url).pathname.startsWith('/u/')) {
    const resolved = await runYtDlp(channel.url, { binary: ytDlpBin, timeoutMs: commandTimeoutMs,
      metadataOnly: true, signal: stopController.signal });
    const candidate = String(resolved.channel_id || resolved.uploader_id || resolved.id || '');
    if (resolved._type === 'playlist' && /^\d+$/.test(candidate)) profileId = candidate;
  }
  if (!profileId) throw new Error('Не удалось определить ID RuTube-канала');
  return parseRutubeProfile(channel, { profileId, signal: requestSignal(commandTimeoutMs) });
}


async function processChannel(channel) {
  const observedAt = new Date().toISOString();
  let metrics;
  let connection;
  try {
    metrics = null;
    connection = (await syncRequest({ action: 'connection', channelId: channel.id, leaseToken: channel.leaseToken })).connection;
    if (connection) {
      const options = { signal: requestSignal(commandTimeoutMs), tiktokClientKey: process.env.TIKTOK_CLIENT_KEY, tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET, vkClientId: process.env.VK_CLIENT_ID, vkServiceToken: process.env.VK_SERVICE_TOKEN, expectedAccountId: connection.accountId };
      const shouldRefresh = ['TikTok', 'VK'].includes(channel.platformName) || (['Instagram', 'Threads'].includes(channel.platformName) && Date.now() - Date.parse(connection.refreshedAt || connection.version) >= 24 * 60 * 60_000);
      if (shouldRefresh) {
        const updated = await refreshAccess(channel.platformName, connection.credentials, options);
        if (updated) {
          // Persist rotating refresh tokens before optional profile/video requests.
          const saved = await reportResult({ action: 'updateConnection', channelId: channel.id, leaseToken: channel.leaseToken, version: connection.version, ...updated });
          connection = { ...connection, ...updated, version: saved.version };
        } else if (channel.platformName !== 'YouTube') throw new SocialApiError('Автопродление не настроено. Проверьте refresh token и приложение в инструкции площадки.');
      }
      metrics = await collectAuthorized(channel, connection, options);
    }
    if (!metrics && channel.platformName === 'Threads') throw new SocialApiError('Канал Threads сохранён. Креатору нужно подключить свой Threads в боте → «Подключить мой API».');
    if (!metrics && channel.platformName === 'YouTube' && process.env.YOUTUBE_API_KEY) {
      try {
        metrics = await collectAuthorized(channel, { credentials: { accessToken: process.env.YOUTUBE_API_KEY } }, { signal: requestSignal(commandTimeoutMs) });
      } catch (error) {
        console.warn(`${new Date().toISOString()} YouTube API fallback: ${compactError(error)}`);
      }
    }
    if (!metrics && channel.platformName === 'RuTube') {
      // An incomplete listing must fail, not fall back to the incorrect profile count.
      metrics = await parseRutubePublicProfile(channel);
    }
    if (!metrics) {
      if (channel.platformName === 'YouTube') {
        try { metrics = await fetchPublicProfile(channel, { signal: requestSignal(35_000) }); }
        catch (error) { console.warn(`YouTube public fallback: ${compactError(error)}`); }
      } else if (['TikTok', 'Instagram'].includes(channel.platformName)) {
        metrics = await fetchPublicProfile(channel, { signal: requestSignal(35_000) });
      } else if (channel.platformName === 'VK') {
        metrics = await parseVkProfile(channel, { token: process.env.VK_API_TOKEN, signal: requestSignal(35_000) });
      }
    }
    if (!metrics) {
      const youtubeFallback = channel.platformName === 'YouTube';
      const raw = await runYtDlp(ytDlpChannelUrl(channel), { binary: ytDlpBin, timeoutMs: commandTimeoutMs,
        playlistLimit, metadataOnly: youtubeFallback, cookieFile: process.env.YTDLP_COOKIES_FILE,
        proxyUrl: process.env.PARSER_PROXY_URL, signal: stopController.signal });
      metrics = mapYtDlpResult(raw, { forceUnknownPublications: youtubeFallback, platformName: channel.platformName });
    }
    ensureMetrics(metrics);
  } catch (error) {
    if (stopping) return;
    if (connection && classifyProviderError(error) === 'needs_auth') await syncRequest({ action: 'updateConnection', channelId: channel.id, leaseToken: channel.leaseToken, version: connection.version, status: 'needs_auth' }).catch(() => {});
    const message = compactError(error instanceof Error ? error.message : error);
    await reportResult({
      action: 'fail',
      channelId: channel.id,
      leaseToken: channel.leaseToken,
      observedAt,
      error: message,
      status: classifyProviderError(error),
      parserSource: channel.platformName.toLowerCase(),
    }).catch((reportError) => {
      console.error(`${new Date().toISOString()} could not report failure: ${compactError(reportError)}`);
    });
    console.error(`${new Date().toISOString()} failed #${channel.id}: ${message}`);
    return;
  }
  // Delivery failures must not turn successfully collected metrics into a parser error.
  try {
    await reportResult({ action: 'complete', channelId: channel.id, leaseToken: channel.leaseToken, observedAt, ...metrics });
    console.log(`${new Date().toISOString()} synced #${channel.id} ${channel.platformName}`);
  } catch (error) {
    if (!stopping) console.error(`${new Date().toISOString()} result delivery failed #${channel.id}: ${compactError(error)}`);
  }
}

async function run() {
  console.log(`${new Date().toISOString()} channel collector started`);
  while (!stopping) {
    try {
      const payload = await syncRequest({ action: 'claim', limit: 1 });
      const channel = payload.channels?.[0];
      if (channel) {
        await processChannel(channel);
        continue;
      }
    } catch (error) {
      if (!stopping) {
        console.error(`${new Date().toISOString()} queue error: ${compactError(error)}`);
      }
    }
    await wait(pollIntervalMs);
  }
  console.log(`${new Date().toISOString()} channel collector stopped`);
}

await run();
