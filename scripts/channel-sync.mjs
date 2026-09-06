#!/usr/bin/env node

import { spawn } from 'node:child_process';

const baseUrl = (process.env.CONTENT_FACTORY_BASE_URL || 'http://127.0.0.1:18082').replace(
  /\/$/,
  '',
);
const syncSecret = process.env.SYNC_SECRET;
const ytDlpBin = process.env.YTDLP_BIN || '/usr/local/bin/yt-dlp';
const pollIntervalMs = Math.max(10, Number(process.env.SYNC_POLL_SECONDS) || 45) * 1_000;
const commandTimeoutMs = Math.max(60, Number(process.env.PARSER_TIMEOUT_SECONDS) || 180) * 1_000;
const playlistLimit = Math.max(10, Number(process.env.PARSER_PLAYLIST_LIMIT) || 120);

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
    throw new Error(payload.error || `Sync API returned ${response.status}`);
  }
  return payload;
}

function executeYtDlp(url, { metadataOnly = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json',
      '--skip-download',
      '--flat-playlist',
      '--ignore-errors',
      '--no-warnings',
      '--no-cache-dir',
      '--socket-timeout',
      '30',
      '--retries',
      '2',
    ];

    if (metadataOnly) args.push('--playlist-items', '0');
    else args.push('--playlist-end', String(playlistLimit));

    if (process.env.YTDLP_COOKIES_FILE) {
      args.push('--cookies', process.env.YTDLP_COOKIES_FILE);
    }
    if (process.env.PARSER_PROXY_URL) {
      args.push('--proxy', process.env.PARSER_PROXY_URL);
    }
    args.push(url);

    const child = spawn(ytDlpBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let stoppingChild = false;
    let forceKillTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, commandTimeoutMs);
    const stopChild = () => {
      stoppingChild = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    };
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      stopController.signal.removeEventListener('abort', stopChild);
    };
    stopController.signal.addEventListener('abort', stopChild, { once: true });

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 20_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code) => {
      cleanup();
      if (stoppingChild) {
        reject(new Error('Сборщик остановлен'));
        return;
      }
      if (timedOut) {
        reject(new Error(`Парсер не ответил за ${Math.round(commandTimeoutMs / 1_000)} сек.`));
        return;
      }
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(compactError(stderr) || `yt-dlp exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Парсер вернул некорректный JSON'));
      }
    });
  });
}

function asNonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
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
  const parts = url.pathname.split('/').filter(Boolean);
  let filter;
  if (parts[0] === 'channel' && parts[1]) filter = ['id', parts[1]];
  else if (parts[0]?.startsWith('@')) filter = ['forHandle', parts[0]];
  else if (parts[0] === 'user' && parts[1]) filter = ['forUsername', parts[1]];
  else if (parts[0] === 'c') {
    const redirected = await fetch(channel.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: requestSignal(20_000),
    });
    const redirectedParts = new URL(redirected.url).pathname.split('/').filter(Boolean);
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
  if (!match) return null;
  const profile = await fetchJson(`https://rutube.ru/api/profile/user/${match[1]}/`, {
    headers: { referer: channel.url },
  });
  return {
    providerChannelId: String(profile.id || match[1]),
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

function entryTimestamp(entry) {
  const direct = Number(entry?.timestamp || entry?.release_timestamp);
  if (Number.isFinite(direct) && direct > 0) return direct * 1_000;
  const date = String(entry?.upload_date || entry?.release_date || '');
  if (!/^\d{8}$/.test(date)) return null;
  const parsed = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function bestAvatar(info) {
  const candidates = Array.isArray(info?.thumbnails) ? info.thumbnails : [];
  return candidates
    .filter((item) => typeof item?.url === 'string' && item.url.startsWith('http'))
    .sort((a, b) => (Number(b.width) || 0) * (Number(b.height) || 0) - (Number(a.width) || 0) * (Number(a.height) || 0))[0]?.url;
}

function mapYtDlpResult(info, { forceUnknownPublications = false } = {}) {
  const entries = (Array.isArray(info?.entries) ? info.entries : []).filter(Boolean);
  const mediaEntries = entries.filter(
    (entry) => entry?._type !== 'playlist' && entry?._type !== 'multi_video',
  );
  const isContainerIndex = entries.length > 0 && mediaEntries.length === 0;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
  let datedEntries = 0;
  let reach30d = 0;
  for (const entry of mediaEntries) {
    const timestamp = entryTimestamp(entry);
    const views = asNonNegativeInteger(entry?.view_count);
    if (timestamp !== null) datedEntries += 1;
    if (timestamp !== null && timestamp >= cutoff && views !== null) reach30d += views;
  }

  const publicationCount =
    (isContainerIndex || forceUnknownPublications
      ? null
      : asNonNegativeInteger(info?.playlist_count)) ??
    (isContainerIndex || forceUnknownPublications
      ? null
      : asNonNegativeInteger(info?.n_entries)) ??
    (!isContainerIndex && !forceUnknownPublications && mediaEntries.length < playlistLimit
      ? mediaEntries.length
      : null);
  const completeEntrySet = publicationCount !== null && publicationCount <= mediaEntries.length;
  const summedViews = mediaEntries.reduce(
    (sum, entry) => sum + (asNonNegativeInteger(entry?.view_count) ?? 0),
    0,
  );
  const totalViews = asNonNegativeInteger(info?.view_count) ?? (completeEntrySet ? summedViews : null);
  const followers = asNonNegativeInteger(info?.channel_follower_count);

  if (followers === null && totalViews === null && publicationCount === null && datedEntries === 0) {
    throw new Error('Платформа не отдала публичные метрики канала');
  }

  return {
    providerChannelId: String(info?.channel_id || info?.uploader_id || info?.id || '').trim() || null,
    handle: String(info?.uploader_id || '').trim() || null,
    title: String(info?.channel || info?.uploader || info?.title || '').trim() || null,
    avatarUrl: bestAvatar(info) || null,
    followers,
    totalViews,
    publicationCount,
    reach30d: datedEntries > 0 ? reach30d : null,
    parserSource: 'yt-dlp',
  };
}

function needsAuthorization(error) {
  return /(login|log in|sign in|cookies?|authentication|authorize|private|403|401|rate.?limit|captcha|requested content is not available)/i.test(
    String(error),
  );
}

async function processChannel(channel) {
  const observedAt = new Date().toISOString();
  try {
    let metrics = null;
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
      const youtubeFallback = channel.platformName === 'YouTube';
      const parserUrl = youtubeFallback ? `${channel.url.replace(/\/$/, '')}/about` : channel.url;
      const raw = await executeYtDlp(parserUrl, { metadataOnly: youtubeFallback });
      metrics = mapYtDlpResult(raw, { forceUnknownPublications: youtubeFallback });
    }
    await syncRequest({
      action: 'complete',
      channelId: channel.id,
      leaseToken: channel.leaseToken,
      observedAt,
      ...metrics,
    });
    console.log(`${new Date().toISOString()} synced #${channel.id} ${channel.platformName}`);
  } catch (error) {
    if (stopping) return;
    const message = compactError(error instanceof Error ? error.message : error);
    await syncRequest({
      action: 'fail',
      channelId: channel.id,
      leaseToken: channel.leaseToken,
      observedAt,
      error: message,
      status: needsAuthorization(message) ? 'needs_auth' : 'error',
      parserSource: 'yt-dlp',
    }).catch((reportError) => {
      console.error(`${new Date().toISOString()} could not report failure: ${compactError(reportError)}`);
    });
    console.error(`${new Date().toISOString()} failed #${channel.id}: ${message}`);
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
