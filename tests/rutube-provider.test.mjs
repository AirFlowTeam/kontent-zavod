import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRutubeProfile } from '../scripts/rutube-provider.mjs';

const channel = { platformName: 'RuTube', url: 'https://rutube.ru/channel/81066311', providerChannelId: '81066311' };
const video = (id, hits = 0, overrides = {}) => ({ id, hits, author: { id: 81066311 }, origin_type: 'rshorts',
  is_hidden: false, is_deleted: false, is_audio: false, is_livestream: false, publication_ts: '2026-09-11T13:50:07', ...overrides });
const page = (results, number = 1, pages = 1) => ({ results, page: number, num_pages: pages,
  has_next: number < pages, next: number < pages ? `https://rutube.ru/api/video/person/81066311/?page=${number + 1}&format=json` : null });
function provider(pages, profile = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => {
    calls.push(String(url));
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.cookie, undefined);
    return Response.json(url.pathname.includes('/profile/')
      ? { id: 81066311, name: 'dari.xplay', video_count: 10, hits: 99999, subscribers_count: 0, ...profile }
      : pages[Number(url.searchParams.get('page')) - 1]);
  } };
}

test('RuTube regression: profile says 10 but six public Shorts sum to 440', async () => {
  const metrics = await parseRutubeProfile(channel, provider([page([1, 235, 4, 196, 0, 4].map((hits, i) => video(`id${i}`, hits)))]));
  assert.equal(metrics.publicationCount, 6);
  assert.equal(metrics.totalViews, 440);
  assert.equal(metrics.totalLikes, null);
  assert.equal(metrics.followers, 0);
  assert.equal(metrics.parserSource, 'rutube-public-videos');
});
test('all pages, exact owner, deduplication, public videos and Shorts only', async () => {
  const p = provider([page([video('a', 5), video('b', 7, { origin_type: 'regular' })], 1, 2),
    page([video('a', 5), video('c', 9), video('hidden', 100, { is_hidden: true }),
      video('deleted', 100, { is_deleted: true }), video('audio', 100, { is_audio: true }),
      video('live', 100, { is_livestream: true })], 2, 2)]);
  const metrics = await parseRutubeProfile(channel, p);
  assert.equal(p.calls.length, 3);
  assert.equal(metrics.publicationCount, 3);
  assert.equal(metrics.totalViews, 21);
});
test('empty public channel is zero; missing or overflow views stay unknown', async () => {
  assert.equal((await parseRutubeProfile(channel, provider([page([])]))).publicationCount, 0);
  for (const hits of [null, -1, 'unknown', Number.MAX_SAFE_INTEGER]) {
    const metrics = await parseRutubeProfile(channel, provider([page([video('a', hits), video('b', 1)])]));
    assert.equal(metrics.publicationCount, 2);
    assert.equal(metrics.totalViews, null);
  }
});
test('wrong profile, wrong owner and malformed publication are rejected', async () => {
  for (const url of ['https://fixture:fixture@rutube.ru/channel/81066311', 'https://rutube.ru:8443/channel/81066311']) {
    const p = provider([]);
    await assert.rejects(parseRutubeProfile({ ...channel, url }, p), /Некорректный адрес/);
    assert.equal(p.calls.length, 0);
  }
  await assert.rejects(parseRutubeProfile(channel, provider([page([])], { id: 123 })), /другой профиль/);
  await assert.rejects(parseRutubeProfile({ ...channel, providerChannelId: '123' }, provider([])), /владелец/);
  for (const entry of [video('a', 1, { author: { id: 123 } }), video('', 1), video('a', 1, { is_deleted: undefined }), video('a', 1, { publication_ts: null })]) {
    await assert.rejects(parseRutubeProfile(channel, provider([page([entry])])));
  }
});
test('missing pages, changed totals, repeated pages and pagination limit never become a partial total', async () => {
  await assert.rejects(parseRutubeProfile(channel, provider([{ results: [] }])), /полноту/);
  await assert.rejects(parseRutubeProfile(channel, provider([page([video('a')], 1, 2), page([], 2, 3)])), /полноту/);
  await assert.rejects(parseRutubeProfile(channel, provider([page([video('a')], 1, 3), page([video('a')], 2, 3)])), /повторяющийся/);
  for (const last of [[], [video('a')]]) {
    await assert.rejects(parseRutubeProfile(channel, provider([page([video('a')], 1, 2), page(last, 2, 2)])), /повторяющийся/);
  }
  await assert.rejects(parseRutubeProfile(channel, { ...provider([page([video('a')], 1, 2)]), maxPages: 1 }), /не сохранён/);
  await assert.rejects(parseRutubeProfile(channel, provider([{ ...page([video('a')]), num_pages: 2 }])), /противоречивое/);
});
test('pagination cannot leave the owner listing or HTTPS origin', async () => {
  for (const next of ['https://evil.example/?page=2', 'https://rutube.ru/api/video/person/123/?page=2', 'http://rutube.ru/api/video/person/81066311/?page=2', 'https://rutube.ru/api/video/person/81066311/?page=1']) {
    const p = provider([{ ...page([video('a')], 1, 2), next }]);
    await assert.rejects(parseRutubeProfile(channel, p), /следующая страница/);
    assert.equal(p.calls.length, 2);
  }
});
test('HTTP and oversized replies fail rather than returning profile counters', async () => {
  await assert.rejects(parseRutubeProfile(channel, { fetchImpl: async () => new Response('', { status: 429 }) }), /429/);
  await assert.rejects(parseRutubeProfile(channel, { fetchImpl: async () => new Response('x'.repeat(2_000_001)) }), /слишком большой/);
});
