import test from 'node:test';
import assert from 'node:assert/strict';
import { storageHarness, onboard } from './storage-harness.mjs';

async function setup(t) {
  const h = storageHarness(); t.after(h.close);
  h.env.SOCIAL_VAULT_KEY = 'a'.repeat(64); h.env.CONTENT_PUBLIC_ORIGIN = 'https://fixture.example';
  const { context } = await onboard(h);
  const storage = h.load('db/storage.ts');
  const id = await storage.createChannel({ creatorId: context.binding.id, url: 'https://youtube.com/@alice' });
  const vault = h.load('db/social-connections.ts');
  const actor = { telegramUserId: '2001', id };
  const token = 'fixture-private-access-token';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [{ id: 'UC1234567890123456789012', snippet: { customUrl: '@alice' }, statistics: { videoCount: '0', viewCount: '0' } }] }));
  const ticket = await vault.createConnectTicket(actor);
  const ticketToken = ticket.url.split('/').at(-1);
  return { h, storage, vault, actor, token, ticketToken, id };
}

test('all TG accounts immediately visible, pending producer displayed, no invitation/token leak', async (t) => {
  const h = storageHarness(); t.after(h.close);
  const flow = h.load('db/telegram-onboarding.ts'); const storage = h.load('db/storage.ts');
  await flow.getTelegramContext({ telegramUserId: '999', username: 'started' });
  let d = await storage.getDashboardData(); assert.equal(d.telegramAccounts.length, 1); assert.equal(d.creators.length, 0);
  await flow.selectTelegramRole({ telegramUserId: '1001', role: 'producer' });
  const invite = await flow.createTelegramInvite({ telegramUserId: '1001', updateId: 1 });
  await flow.acceptTelegramInvite({ telegramUserId: '999', token: invite.token });
  d = await storage.getDashboardData(); const a = d.telegramAccounts.find((a) => a.telegramUserId === '999');
  assert.ok(a.producerId); assert.match(a.stage, /ИИ/); assert.ok(!JSON.stringify(d).includes(invite.token));
  assert.ok(!JSON.stringify(d).includes('pendingInviteHash')); assert.equal(a.channelCount, 0);
  const rev = h.load('app/api/revision/route.ts').GET;
  const before = await (await rev()).text();
  await flow.selectTelegramCreatorType({ telegramUserId: '999', type: 'UGC' });
  assert.notEqual(await (await rev()).text(), before);
  d = await storage.getDashboardData(); assert.equal(d.creators.length, 1); assert.equal(d.channels.length, 0);
});

test('encrypted storage, single-use form, wrong owner/lease blocked, no token in dashboard', async (t) => {
  const { h, storage, vault, actor, token, ticketToken, id } = await setup(t);
  await onboard(h, { producerId: '1002', creatorId: '2002' });
  await assert.rejects(vault.createConnectTicket({ ...actor, telegramUserId: '2002' }), /не найден/);
  await vault.saveConnectTicket(ticketToken, { accessToken: token });
  await assert.rejects(vault.saveConnectTicket(ticketToken, { accessToken: token }), /использована/);
  const row = h.sqlite.prepare('SELECT * FROM social_connections').get();
  assert.ok(row.ciphertext.startsWith('v1.')); assert.ok(!row.ciphertext.includes(token));
  assert.ok(!JSON.stringify(await storage.getDashboardData()).includes(token));
  assert.ok(!JSON.stringify(await storage.getDashboardData()).includes('ciphertext'));
  const [claim] = await storage.claimDueChannels();
  await assert.rejects(vault.collectorConnection({ channelId: id, leaseToken: 'wrong' }), /сборщику/);
  const c = await vault.collectorConnection({ channelId: id, leaseToken: claim.leaseToken });
  assert.equal(c.credentials.accessToken, token);
  h.sqlite.prepare("UPDATE creators SET status='inactive' WHERE id=?").run(row.creator_id);
  await assert.rejects(vault.collectorConnection({ channelId: id, leaseToken: claim.leaseToken }), /сборщику/);
  h.sqlite.prepare("UPDATE creators SET status='active' WHERE id=?").run(row.creator_id);
  await vault.disconnectSocial(actor);
  await assert.rejects(vault.updateCollectorConnection({ channelId: id, leaseToken: claim.leaseToken, version: c.version, credentials: { accessToken: 'old-token-value' }, expiresAt: new Date(Date.now() + 10000).toISOString() }), /сборщику/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
});

test('expired/replaced tickets and archived channels cannot connect; deletion erases secrets', async (t) => {
  const { h, storage, vault, actor, token, ticketToken, id } = await setup(t);
  const newer = (await vault.createConnectTicket(actor)).url.split('/').at(-1);
  await assert.rejects(vault.connectTicket(ticketToken), /истекла/);
  await vault.saveConnectTicket(newer, { accessToken: token });
  const pending = (await vault.createConnectTicket(actor)).url.split('/').at(-1);
  await storage.deleteChannel({ id });
  await assert.rejects(vault.connectTicket(pending), /истекла/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connect_tickets').get().n, 0);
});

test('public form keeps origin and cache protection; legacy import never echoes secrets', async (t) => {
  const { h, token, ticketToken, id } = await setup(t);
  const route = h.load('app/connect/[token]/route.ts');
  const context = { params: Promise.resolve({ token: ticketToken }) };
  const get = await route.GET(new Request('https://fixture.example/connect/' + ticketToken), context);
  assert.equal(get.status, 200); assert.match(get.headers.get('cache-control'), /no-store/);
  assert.equal(get.headers.get('referrer-policy'), 'strict-origin');
  const html = await get.text();
  assert.doesNotMatch(html, /name="accessToken"/);
  assert.match(html, /Официальный вход ещё не настроен/);
  const post = (origin) => route.POST(new Request('https://fixture.example/connect/' + ticketToken, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ accessToken: token }) }), context);
  assert.equal((await post('https://evil.example')).status, 403);
  const success = await post('https://fixture.example'); assert.equal(success.status, 303);
  assert.equal(success.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(success.headers.get('location'), `/connect/success?channel=${id}`);
  assert.ok(!(await success.text()).includes(token));
  assert.equal((await post('https://fixture.example')).status, 410);
});

test('YouTube form exposes official Google login only when configured, never a credential field', async (t) => {
  const { h, ticketToken } = await setup(t);
  h.env.YOUTUBE_API_KEY = 'fixture-private-shared-key';
  const route = h.load('app/connect/[token]/route.ts');
  const get = () => route.GET(new Request('https://fixture.example/connect/' + ticketToken), { params: Promise.resolve({ token: ticketToken }) });
  const blocked = await get(); const blockedHtml = await blocked.text();
  assert.equal(blocked.status, 200); assert.match(blockedHtml, /Официальный вход ещё не настроен/);
  assert.doesNotMatch(blockedHtml, /name="accessToken"|value="oauth"/);
  Object.assign(h.env, { YOUTUBE_CLIENT_ID: 'fixture.apps.googleusercontent.com', YOUTUBE_CLIENT_SECRET: 'fixture-google-secret', YOUTUBE_OAUTH_ENABLED: 'true' });
  const ready = await get(); const html = await ready.text();
  assert.match(html, /Войти через Google/); assert.match(html, /value="oauth"/);
  assert.doesNotMatch(html, /name="accessToken"|У меня уже есть готовый токен/);
  assert.match(ready.headers.get('content-security-policy'), /form-action[^;]*https:\/\/accounts\.google\.com/);
  for (const secret of [h.env.YOUTUBE_API_KEY,h.env.YOUTUBE_CLIENT_SECRET]) assert.ok(!html.includes(secret));
});

test('provider rejection releases the manual form for correction; success remains single-use', async (t) => {
  const { h, vault, ticketToken, token } = await setup(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { errors: [{ reason: 'keyInvalid' }], message: token } }, { status: 400 }));
  await assert.rejects(vault.saveConnectTicket(ticketToken, { accessToken: token }), (e) => /недействителен/.test(e.message) && !e.message.includes(token));
  assert.equal(h.sqlite.prepare('SELECT consumed FROM social_connect_tickets').get().consumed, 0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connections').get().n, 0);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [{ id: 'UC1234567890123456789012', snippet: { customUrl: '@alice' }, statistics: { videoCount: '0', viewCount: '0' } }] }));
  await vault.saveConnectTicket(ticketToken, { accessToken: 'corrected-private-api-key' });
  assert.equal(h.sqlite.prepare('SELECT consumed FROM social_connect_tickets').get().consumed, 1);
  await assert.rejects(vault.saveConnectTicket(ticketToken, { accessToken: token }), /использована/);
});

test('replaced ticket is not revived when a provider request finishes with an error', async (t) => {
  const { h, vault, actor, ticketToken, token } = await setup(t);
  t.mock.method(globalThis, 'fetch', async () => {
    await vault.createConnectTicket(actor);
    return Response.json({ error: { errors: [{ reason: 'keyInvalid' }] } }, { status: 400 });
  });
  await assert.rejects(vault.saveConnectTicket(ticketToken, { accessToken: token }));
  await assert.rejects(vault.connectTicket(ticketToken), /истекла/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM social_connect_tickets').get().n, 1);
});

test('public origin refuses credentials and non-origin URLs before creating a ticket', async (t) => {
  const { h, vault, actor } = await setup(t);
  for (const origin of ['https://user:password@fixture.example', 'https://fixture.example/path', 'https://fixture.example?query=1']) {
    h.env.CONTENT_PUBLIC_ORIGIN = origin;
    await assert.rejects(vault.createConnectTicket(actor), /администратором/);
  }
});

test('connection error offers correction only while the ticket can still open its form', async (t) => {
  const { h, vault, ticketToken, token } = await setup(t);
  const route = h.load('app/connect/[token]/route.ts'), context = { params: Promise.resolve({ token: ticketToken }) };
  const post = (action) => route.POST(new Request(`https://fixture.example/connect/${ticketToken}`, { method: 'POST', headers: {
    origin: 'https://fixture.example', 'content-type': 'application/x-www-form-urlencoded',
  }, body: new URLSearchParams({ action, accessToken: token }) }), context);
  const invalid = await post('invalid');
  assert.match(await invalid.text(), /Исправить данные в этой форме/);
  await vault.saveConnectTicket(ticketToken, { accessToken: token });
  // A bad action fails before accessing the ticket. The renderer still must not
  // offer a link to an already consumed form merely because its error is 400.
  const consumed = await post('invalid');
  assert.equal(consumed.status, 400); assert.doesNotMatch(await consumed.text(), /Исправить данные в этой форме/);
});

test('personal YouTube form to encrypted connection to stored metrics uses only the submitted key', async (t) => {
  const { h, storage, vault, token, ticketToken, id } = await setup(t);
  h.env.YOUTUBE_API_KEY = 'different-server-key-must-not-be-used';
  const accountId = 'UC1234567890123456789012';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input); requests.push(url.searchParams.get('key'));
    assert.equal(url.searchParams.get('key'), token);
    if (url.pathname.endsWith('/channels')) return Response.json({ items: [{ id: accountId,
      snippet: { title: 'Personal creator', customUrl: '@alice' },
      statistics: { videoCount: '2', viewCount: '120', subscriberCount: '9' },
      contentDetails: { relatedPlaylists: { uploads: 'UUfixture' } },
    }] });
    if (url.pathname.endsWith('/playlistItems')) return Response.json({ items: ['one','two'].map((videoId) => ({ contentDetails: { videoId } })) });
    if (url.pathname.endsWith('/videos')) return Response.json({ items: url.searchParams.get('id').split(',').map((videoId) => ({ id: videoId,
      snippet: { channelId: accountId }, status: { privacyStatus: 'public' }, statistics: { likeCount: videoId === 'one' ? '3' : '5' },
    })) });
    throw new Error('Unexpected provider method');
  });
  const route = h.load('app/connect/[token]/route.ts');
  const response = await route.POST(new Request('https://fixture.example/connect/' + ticketToken, {
    method: 'POST', headers: { origin: 'https://fixture.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'manual', accessToken: token }),
  }), { params: Promise.resolve({ token: ticketToken }) });
  assert.equal(response.status, 303);
  const saved = h.sqlite.prepare('SELECT status,ciphertext FROM social_connections WHERE channel_id=?').get(id);
  assert.equal(saved.status, 'connected'); assert.ok(!saved.ciphertext.includes(token));
  assert.equal(h.sqlite.prepare('SELECT sync_status FROM creator_channels WHERE id=?').get(id).sync_status, 'pending');
  const [channel] = await storage.claimDueChannels();
  const connection = await vault.collectorConnection({ channelId: id, leaseToken: channel.leaseToken });
  const { collectYouTubeWithPersonalKey } = await import('../scripts/youtube-personal-api.mjs');
  const metrics = await collectYouTubeWithPersonalKey(channel, connection);
  await storage.completeChannelSync({ channelId: id, leaseToken: channel.leaseToken, observedAt: new Date().toISOString(), ...metrics });
  const result = h.sqlite.prepare('SELECT sync_status,total_views,publication_count,total_likes FROM creator_channels WHERE id=?').get(id);
  assert.equal(result.sync_status, 'success'); assert.equal(result.total_views, 120);
  assert.equal(result.publication_count, 2); assert.equal(result.total_likes, 8);
  assert.ok(requests.length > 3); assert.deepEqual([...new Set(requests)], [token]);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM channel_sync_history WHERE channel_id=? AND status=\'success\'').get(id).n, 1);
  assert.ok(!JSON.stringify(await storage.getDashboardData()).includes(token));
});

test('personal key on a paused channel preserves pause and explicitly asks to resume collection', async (t) => {
  const { h, storage, ticketToken, token, id } = await setup(t);
  await storage.updateChannel({ id, status: 'inactive' });
  const route = h.load('app/connect/[token]/route.ts');
  const context = { params: Promise.resolve({ token: ticketToken }) };
  const url = 'https://fixture.example/connect/' + ticketToken;
  const form = await route.GET(new Request(url), context);
  assert.match(await form.text(), /приостановлен.*Возобновить сбор/);
  const saved = await route.POST(new Request(url, { method: 'POST', headers: {
    origin: 'https://fixture.example', 'content-type': 'application/x-www-form-urlencoded',
  }, body: new URLSearchParams({ accessToken: token }) }), context);
  assert.equal(saved.status, 303); assert.equal(saved.headers.get('location'), `/connect/success?channel=${id}&paused=1`);
  assert.equal(h.sqlite.prepare('SELECT status FROM creator_channels WHERE id=?').get(id).status, 'inactive');
  assert.deepEqual(await storage.claimDueChannels(), []);
  const success = await h.load('app/connect/success/route.ts').GET(new Request(`https://fixture.example/connect/success?channel=${id}&paused=1`));
  const html = await success.text();
  assert.match(html, new RegExp(`start=check_${id}`));
  assert.match(html, /Возобновить сбор/); assert.doesNotMatch(html, /Первая проверка поставлена в очередь/);
});
