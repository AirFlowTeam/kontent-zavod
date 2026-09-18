import { metaSubjectHash } from './meta-signed-request.mjs';

// Only an OAuth exchange performed by this service proves the issuing app.
// An arbitrary manually supplied access token must NOT be attributed to our app.
export async function metaConnectionIdentity(platformName, identity, env, oauthStateHash) {
  if (!oauthStateHash || !['Instagram', 'Threads'].includes(platformName)) return null;
  const provider = platformName === 'Instagram' ? 'instagram' : 'threads';
  const appId = env[`${provider.toUpperCase()}_CLIENT_ID`];
  const subjectId = provider === 'instagram' ? identity.profile?.id : identity.accountId;
  if (typeof appId !== 'string' || !/^[1-9]\d{0,63}$/.test(appId)
    || typeof subjectId !== 'string' || !/^[1-9]\d{0,63}$/.test(subjectId)) throw new Error('Verified Meta callback identity is unavailable');
  return { provider, appId, subjectHash: await metaSubjectHash(provider, appId, subjectId) };
}
