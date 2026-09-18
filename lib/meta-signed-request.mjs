// Meta envelope reference (retrieved 2026-09-17; updated 2025-11-07):
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/
// HMAC covers the original encoded payload, NOT decoded or reserialized JSON.
export class MetaCallbackError extends Error {
  constructor(message = 'Invalid Meta callback', status = 400) { super(message); this.status = status; }
}
const BODY_LIMIT = 24_576;
const ENVELOPE_LIMIT = 16_384;
const fail = (message, status) => { throw new MetaCallbackError(message, status); };
const bytes = (encoded) => {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(encoded) || encoded.replace(/=+$/, '').length % 4 === 1) fail();
  try {
    const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const canonical = btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (canonical !== encoded.replace(/=+$/, '')) fail();
    return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  }
  catch { fail(); }
};
export async function readSignedRequest(request) {
  if (request.method !== 'POST') fail('Method not allowed', 405);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') fail('Expected form encoded signed_request', 415);
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) fail('Callback body too large', 413);
  const reader = request.body?.getReader();
  if (!reader) fail();
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BODY_LIMIT) { await reader.cancel(); fail('Callback body too large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  let fields;
  try { fields = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { fail(); }
  if (fields.getAll('signed_request').length !== 1) fail();
  const envelope = fields.get('signed_request');
  if (!envelope || envelope.length > ENVELOPE_LIMIT) fail();
  return envelope;
}
export async function verifySignedRequest(envelope, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || !secret.trim()) fail('Meta callback secret is not configured', 503);
  if (typeof envelope !== 'string' || envelope.length > ENVELOPE_LIMIT) fail();
  const parts = envelope.split('.');
  if (parts.length !== 2) fail();
  const [signature, encoded] = parts;
  const signatureBytes = bytes(signature);
  if (signatureBytes.byteLength !== 32) fail();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(encoded))) fail('Invalid callback signature', 403);
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(encoded))); }
  catch { fail(); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || typeof payload.algorithm !== 'string' || payload.algorithm.toUpperCase() !== 'HMAC-SHA256'
    || typeof payload.user_id !== 'string' || !/^[1-9]\d{0,63}$/.test(payload.user_id)
    || !Number.isSafeInteger(payload.issued_at) || payload.issued_at <= 0 || payload.issued_at > nowSeconds + 300) fail();
  // issued_at is required for the reconnect fence. No arbitrary maximum age:
  // authentic delayed callbacks/retries must work; storage deduplicates replays.
  if (payload.expires !== undefined && (!Number.isSafeInteger(payload.expires) || payload.expires < 0)) fail();
  return { subjectId: payload.user_id, issuedAt: payload.issued_at, canonicalEnvelope: `${signature.replace(/=+$/, '')}.${encoded}` };
}
export async function digestMeta(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export const metaSubjectHash = (provider, appId, subjectId) => digestMeta(`meta-subject:v1:${provider}:${appId}:${subjectId}`);
