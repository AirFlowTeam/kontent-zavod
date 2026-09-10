#!/usr/bin/env node

import { runYtDlp } from './yt-dlp-runner.mjs';
import { asNonNegativeInteger, ensureMetrics, mapYtDlpResult, ytDlpChannelUrl, classifyProviderError } from './channel-parser-lib.mjs';
import { fetchPublicProfile, parseVkProfile } from './channel-providers.mjs';

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


async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'user-agent': 'KontentZavod/1.0 (+channel metrics collector)',
      ...init.headers,
    },
    signal: requestSignal(30_000),
  });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json();
}

async function parseYouTubeWithApi(channel) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  const url = new URL(channel.url);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  let filter;
  if (channel.providerChannelId && /^UC[A-Za-z0-9_-]{22}$/.test(channel.providerChannelId)) filter = ['id', channel.providerChannelId];
  else if (parts[0] === 'channel' && parts[1]) filter = ['id', parts[1]];
  else if (parts[0]?.startsWith('@')) filter = ['forHandle', parts[0]];
  else if (parts[0] === 'user' && parts[1]) filter = ['forUsername', parts[1]];
  else if (parts[0] === 'c') {
    const redirected = await fetch(channel.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: requestSignal(20_000),
    });
    const redirectedParts = new URL(redirected.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (redirectedParts[0]?.startsWith('@')) filter = ['forHandle', redirectedParts[0]];
  }
  if (!filter) return null;

  const query = new URLSearchParams({ part: 'id,snippet,statistics', key: apiKey });
  query.set(filter[0], filter[1]);
  const payload = await fetchJson(`https://www.googleapis.com/youtube/v3/channels?${query}`);
  const item = payload.items?.[0];
  if (!item) throw new Error('Канал YouTube не найден');
  const thumbnails = Object.values(item.snippet?.thumbnails || {});
  const avatar = thumbnails.sort(
    (a, b) => (Number(b?.width) || 0) * (Number(b?.height) || 0) - (Number(a?.width) || 0) * (Number(a?.height) || 0),
  )[0]?.url;
  return {
    providerChannelId: item.id || null,
    handle: item.snippet?.customUrl || (filter[0] === 'forHandle' ? filter[1] : null),
    title: item.snippet?.title || null,
    avatarUrl: avatar || null,
    followers: item.statistics?.hiddenSubscriberCount
      ? null
      : asNonNegativeInteger(item.statistics?.subscriberCount),
    totalViews: asNonNegativeInteger(item.statistics?.viewCount),
    publicationCount: asNonNegativeInteger(item.statistics?.videoCount),
    reach30d: null,
    parserSource: 'youtube-data-api',
  };
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
  const profile = await fetchJson(`https://rutube.ru/api/profile/user/${profileId}/`, {
    headers: { referer: channel.url },
  });
  return {
    providerChannelId: String(profile.id || profileId),
    handle: null,
    title: String(profile.name || '').trim() || null,
    avatarUrl: profile.avatar_url || null,
    followers: asNonNegativeInteger(profile.subscribers_count),
    totalViews: asNonNegativeInteger(profile.hits),
    publicationCount: asNonNegativeInteger(profile.video_count),
    reach30d: null,
    parserSource: 'rutube-public-web',
  };
}


async function processChannel(channel) {
  const observedAt = new Date().toISOString();
  let metrics;
  try {
    metrics = null;
    if (channel.platformName === 'YouTube') {
      try {
        metrics = await parseYouTubeWithApi(channel);
      } catch (error) {
        console.warn(`${new Date().toISOString()} YouTube API fallback: ${compactError(error)}`);
      }
    }
    if (!metrics) {
      try {
        metrics = await parseRutubePublicProfile(channel);
      } catch (error) {
        console.warn(`${new Date().toISOString()} RuTube API fallback: ${compactError(error)}`);
      }
    }
    if (!metrics) {
      if (['TikTok', 'Instagram'].includes(channel.platformName)) {
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
