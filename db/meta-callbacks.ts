import { env } from 'cloudflare:workers';
import { configuredOrigin, randomHex } from '@/lib/social-oauth.mjs';
import { digestMeta, metaSubjectHash, MetaCallbackError, readSignedRequest, verifySignedRequest } from '@/lib/meta-signed-request.mjs';

const providers = { instagram: { platform: 'Instagram', prefix: 'INSTAGRAM' }, threads: { platform: 'Threads', prefix: 'THREADS' } };
type Provider = keyof typeof providers;
type Kind = 'deauthorize' | 'data-deletion';
type Receipt = { confirmationCode: string; provider: string; kind: string; status: string; affectedChannels: number; processedAt: string };
const selection = `SELECT confirmation_code AS confirmationCode,provider,kind,status,affected_channels AS affectedChannels,processed_at AS processedAt FROM meta_callback_receipts`;
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
export async function metaCallback(request: Request, provider: string, kind: Kind) {
  if (!Object.hasOwn(providers, provider) || !['deauthorize', 'data-deletion'].includes(kind)) throw new MetaCallbackError('Unknown callback', 404);
  const config = providers[provider as Provider];
  const appId = Reflect.get(env, `${config.prefix}_CLIENT_ID`);
  const secret = Reflect.get(env, `${config.prefix}_CLIENT_SECRET`);
  const origin = configuredOrigin(env);
  if (typeof appId !== 'string' || !/^[1-9]\d{0,63}$/.test(appId) || !origin) throw new MetaCallbackError('Callback is not configured', 503);
  const envelope = await readSignedRequest(request);
  const verified = await verifySignedRequest(envelope, secret);
  const subjectHash = await metaSubjectHash(provider, appId, verified.subjectId);
  const eventHash = await digestMeta(`meta-event:v1:${provider}:${appId}:${kind}:${verified.canonicalEnvelope}`);
  const code = randomHex();
  const now = new Date().toISOString();
  const binding = env.DB;
  // The first statement snapshots the target IDs inside the SAME transaction.
  // This invocation's random code fences mutations when a replay already won.
  const target = `SELECT value FROM json_each((SELECT target_ids FROM meta_callback_receipts WHERE event_hash=? AND confirmation_code=? AND status='processing'))`;
  const targetArgs = [eventHash, code];
  const statements = [binding.prepare(`INSERT INTO meta_callback_receipts(event_hash,confirmation_code,provider,app_id,subject_hash,issued_at,kind,status,affected_channels,target_ids,processed_at)
    VALUES(?,?,?,?,?,?,?,'processing',0,(SELECT json_group_array(ch.id) FROM meta_account_links m
      JOIN creator_channels ch ON ch.id=m.channel_id AND ch.creator_id=m.creator_id
      JOIN platforms pf ON pf.id=ch.platform_id
      WHERE m.provider=? AND m.app_id=? AND m.subject_hash=? AND m.authorized_at<? AND pf.name=?),?)
    ON CONFLICT(event_hash) DO NOTHING`).bind(eventHash, code, provider, appId, subjectHash, verified.issuedAt, kind,
      provider, appId, subjectHash, verified.issuedAt, config.platform, now),
    binding.prepare(`UPDATE meta_callback_receipts SET affected_channels=json_array_length(target_ids)
      WHERE event_hash=? AND confirmation_code=? AND status='processing'`).bind(...targetArgs),
    // Invalidate in-flight collector leases before deleting credentials. An old
    // collector result cannot reinsert provider-derived statistics after this.
    binding.prepare(`UPDATE creator_channels SET status='inactive',sync_status='needs_auth',sync_error='Доступ отозван владельцем в Meta. Подключите аккаунт заново, затем нажмите «Возобновить сбор» в боте.',
      next_sync_at=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id IN (${target})`).bind(now, ...targetArgs),
    binding.prepare(`DELETE FROM social_connect_tickets WHERE channel_id IN (${target})`).bind(...targetArgs),
    binding.prepare(`DELETE FROM social_connections WHERE channel_id IN (${target})`).bind(...targetArgs),
  ];
  if (kind === 'data-deletion') {
    for (const table of ['channel_sync_history', 'telegram_submissions', 'telegram_channel_rechecks']) {
      statements.push(binding.prepare(`DELETE FROM ${table} WHERE channel_id IN (${target})`).bind(...targetArgs));
    }
    // meta_account_links cascades only after all dependent channel data is gone.
    // Unrelated legacy videos, creator/producer/Telegram profiles are untouched.
    statements.push(binding.prepare(`DELETE FROM creator_channels WHERE id IN (${target})`).bind(...targetArgs));
  }
  statements.push(binding.prepare(`UPDATE meta_callback_receipts SET status=CASE
      WHEN affected_channels>0 THEN ?
      WHEN EXISTS(SELECT 1 FROM meta_account_links m JOIN creator_channels ch ON ch.id=m.channel_id AND ch.creator_id=m.creator_id
        JOIN platforms pf ON pf.id=ch.platform_id WHERE m.provider=? AND m.app_id=? AND m.subject_hash=? AND m.authorized_at>=? AND pf.name=?)
        THEN 'newer_connection_preserved'
      ELSE 'no_matching_data' END,target_ids=NULL
    WHERE event_hash=? AND confirmation_code=? AND status='processing'`).bind(kind === 'data-deletion' ? 'operational_deleted' : 'deauthorized',
      provider, appId, subjectHash, verified.issuedAt, config.platform, ...targetArgs));
  await binding.batch(statements);
  const receipt = await binding.prepare(`${selection} WHERE event_hash=?`).bind(eventHash).first<Receipt>();
  if (!receipt || receipt.status === 'processing') throw new MetaCallbackError('Callback was not completed', 503);
  return kind === 'data-deletion'
    ? { url: `${origin}/connect/meta/deletion/${receipt.confirmationCode}`, confirmation_code: receipt.confirmationCode }
    : { success: true };
}
export async function metaCallbackResponse(request: Request, provider: string, kind: Kind) {
  try { return new Response(JSON.stringify(await metaCallback(request, provider, kind)), { headers }); }
  catch (error) {
    // Never echo the envelope, subject ID, provider secret, credentials or SQL.
    const status = error instanceof MetaCallbackError ? error.status : 503;
    return new Response(JSON.stringify({ error: status >= 500 ? 'Callback temporarily unavailable' : 'Invalid callback request' }), { status, headers });
  }
}
export async function metaDeletionStatus(code: string) {
  if (!/^[a-f0-9]{64}$/.test(code)) return null;
  return env.DB.prepare(`${selection} WHERE confirmation_code=? AND kind='data-deletion' AND status<>'processing'`).bind(code).first<Receipt>();
}
