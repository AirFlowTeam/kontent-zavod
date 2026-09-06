import { env } from 'cloudflare:workers';

export type SyncAuthorization = 'authorized' | 'misconfigured' | 'unauthorized';

function syncSecret() {
  const value: unknown = Reflect.get(env, 'SYNC_SECRET');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function digest(value: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

type TimingSafeSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean;
};

function supportsTimingSafeEqual(value: SubtleCrypto): value is TimingSafeSubtleCrypto {
  return typeof Reflect.get(value, 'timingSafeEqual') === 'function';
}

function fixedLengthEqual(left: ArrayBuffer, right: ArrayBuffer) {
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function authorizeSyncRequest(request: Request): Promise<SyncAuthorization> {
  const expected = syncSecret();
  if (!expected) return 'misconfigured';
  const provided = request.headers.get('x-sync-secret') ?? '';
  const [providedHash, expectedHash] = await Promise.all([digest(provided), digest(expected)]);
  const matches = supportsTimingSafeEqual(crypto.subtle)
    ? crypto.subtle.timingSafeEqual(providedHash, expectedHash)
    : fixedLengthEqual(providedHash, expectedHash);
  return matches ? 'authorized' : 'unauthorized';
}
