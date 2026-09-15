import { SocialApiError, parseCredentials } from './social-api.mjs';

// Server configuration only. Never return app secrets or tokens to browser DTOs.
export const oauthProviders = {
  instagram: { platform: 'Instagram', prefix: 'INSTAGRAM', required: ['INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET'], scopes: ['instagram_business_basic', 'instagram_business_manage_insights'], auth: 'https://www.instagram.com/oauth/authorize' },
  threads: { platform: 'Threads', prefix: 'THREADS', required: ['THREADS_CLIENT_ID', 'THREADS_CLIENT_SECRET'], scopes: ['threads_basic', 'threads_manage_insights'], auth: 'https://threads.com/oauth/authorize' },
  tiktok: { platform: 'TikTok', prefix: 'TIKTOK', required: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'], scopes: ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'], auth: 'https://www.tiktok.com/v2/auth/authorize/' },
  vk: { platform: 'VK', prefix: 'VK', required: ['VK_CLIENT_ID', 'VK_SERVICE_TOKEN'], scopes: ['video'], auth: 'https://id.vk.ru/authorize' },
};
export const providerFor = (platform) => Object.keys(oauthProviders).find((id) => oauthProviders[id].platform === platform);
export function configuredOrigin(env) {
  try {
    const raw = env.CONTENT_PUBLIC_ORIGIN;
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && raw === u.origin ? u.origin : null;
  } catch { return null; }
}
export function integrationStatus(env) {
  const origin = configuredOrigin(env);
  const vaultReady = /^[a-f0-9]{64}$/.test(env.SOCIAL_VAULT_KEY || '');
  return [...Object.entries(oauthProviders).map(([id, p]) => {
    const missing = p.required.filter((key) => typeof env[key] !== 'string' || !env[key].trim());
    if (!origin) missing.push('CONTENT_PUBLIC_ORIGIN');
    if (!vaultReady) missing.push('SOCIAL_VAULT_KEY');
    const enabled = env[`${p.prefix}_OAUTH_ENABLED`] === 'true';
    return { id, platform: p.platform, ready: missing.length === 0 && enabled, missing,
      status: missing.length ? 'Нужна настройка приложения' : enabled ? 'Вход включён — требуется проверка реальным аккаунтом' : 'Вход выключен до настройки и проверки приложения',
      callbackUrl: origin ? `${origin}/connect/oauth/${id}/callback` : null, scopes: p.scopes, enableVariable: `${p.prefix}_OAUTH_ENABLED` };
  }), { id: 'youtube', platform: 'YouTube', ready: Boolean(origin && vaultReady), missing: [], status: 'Каждый креатор подключает личный YouTube Data API key через бота', callbackUrl: null, scopes: [], enableVariable: null },
  { id: 'rutube', platform: 'RuTube', ready: true, missing: [], status: 'Публичный сбор без ключа; лайки недоступны', callbackUrl: null, scopes: [], enableVariable: null }];
}
function config(id, env) {
  const p = oauthProviders[id];
  if (!p || !integrationStatus(env).find((item) => item.id === id)?.ready) throw new SocialApiError('Администратор ещё не настроил вход этой площадки. Канал сохранён; обратитесь к продюсеру.');
  return { ...p, redirectUri: `${configuredOrigin(env)}/connect/oauth/${id}/callback` };
}
export const randomHex = () => [...crypto.getRandomValues(new Uint8Array(32))].map((v) => v.toString(16).padStart(2, '0')).join('');
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export async function pkceChallenge(verifier) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function authorizationUrl(id, env, state, verifier) {
  const p = config(id, env);
  const u = new URL(p.auth);
  u.search = new URLSearchParams({ response_type: 'code', redirect_uri: p.redirectUri, scope: p.scopes.join(id === 'vk' ? ' ' : ','), state,
    ...(id === 'tiktok' ? { client_key: env.TIKTOK_CLIENT_KEY } : { client_id: env[`${p.prefix}_CLIENT_ID`] }),
    ...(id === 'instagram' ? { force_reauth: 'true' } : {}),
    ...(id === 'vk' ? { code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256' } : {}) }).toString();
  return u.toString();
}
// VK may send a JSON payload instead of flat query fields. Reject ambiguity.
export function callbackParams(id, url) {
  const q = new URL(url).searchParams;
  const keys = ['state', 'code', 'error', 'device_id'];
  for (const k of [...keys, 'payload']) if (q.getAll(k).length > 1) throw new SocialApiError('Неоднозначный ответ авторизации. Начните подключение заново.');
  let payload = {};
  if (q.has('payload')) {
    if (id !== 'vk' || q.get('payload').length > 12000) throw new SocialApiError('Некорректный ответ авторизации.');
    try { payload = JSON.parse(q.get('payload')); } catch { throw new SocialApiError('Некорректный ответ VK ID.'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload.type && payload.type !== 'code_v2')) throw new SocialApiError('Некорректный тип ответа VK ID.');
  }
  /** @type {Record<string, string>} */
  const result = {};
  for (const k of keys) {
    if (payload[k] !== undefined && typeof payload[k] !== 'string') throw new SocialApiError('Некорректный ответ авторизации.');
    if (q.has(k) && payload[k] !== undefined && q.get(k) !== payload[k]) throw new SocialApiError('Противоречивый ответ авторизации.');
    const value = payload[k] ?? q.get(k);
    if (value !== null && value !== undefined) {
      if (value.length > 8192 || /[\x00-\x1f]/.test(value)) throw new SocialApiError('Некорректный ответ авторизации.');
      result[k] = value;
    }
  }
  if (!/^[a-f0-9]{64}$/.test(result.state || '')) throw new SocialApiError('Состояние авторизации отсутствует. Получите новую ссылку в боте.');
  return result;
}
const allowedOrigins = new Set(['https://api.instagram.com', 'https://graph.instagram.com', 'https://graph.threads.com', 'https://open.tiktokapis.com', 'https://id.vk.ru']);
async function tokenRequest(url, init, options) {
  if (!allowedOrigins.has(new URL(url).origin)) throw new SocialApiError('Недопустимый адрес авторизации.');
  try {
    const r = await (options.fetchImpl || fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
    const reader = r.body?.getReader(); if (!reader) throw new Error();
    const chunks = []; let length = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 65536) { await reader.cancel(); throw new Error(); } chunks.push(value); }
    const all = new Uint8Array(length); let offset = 0; for (const c of chunks) { all.set(c, offset); offset += c.length; }
    const data = JSON.parse(new TextDecoder().decode(all));
    if (!r.ok || data.error || data.error_code) throw new Error();
    return data;
  } catch { throw new SocialApiError('Соцсеть не завершила авторизацию. Проверьте разрешения приложения и попробуйте снова. Прежний доступ сохранён.'); }
}
function requireScopes(value, scopes) {
  const granted = new Set(Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[ ,]+/) : []);
  if (scopes.some((scope) => !granted.has(scope))) throw new SocialApiError('Не выданы все разрешения для статистики. Подключите аккаунт заново и разрешите профиль, видео и статистику.');
}
export async function exchangeCode(id, env, params, verifier, options = {}) {
  const p = config(id, env);
  if (!params.code || (id === 'vk' && !params.device_id)) throw new SocialApiError('Соцсеть не прислала код авторизации. Начните заново.');
  let r; let accountId;
  if (id === 'threads') {
    const body = new FormData();
    for (const [k, v] of Object.entries({ client_id: env.THREADS_CLIENT_ID, client_secret: env.THREADS_CLIENT_SECRET, grant_type: 'authorization_code', redirect_uri: p.redirectUri, code: params.code })) body.set(k, v);
    const short = await tokenRequest('https://graph.threads.com/oauth/access_token', { method: 'POST', body }, options);
    if (!short.access_token) throw new SocialApiError('Threads не выдал доступ.');
    const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: env.THREADS_CLIENT_SECRET, access_token: short.access_token });
    r = await tokenRequest(`https://graph.threads.com/access_token?${q}`, {}, options);
    // Token response user_id can be an unsafe JSON number. /me returns an exact
    // string ID; verify this identity again against the submitted channel later.
    const me = await tokenRequest('https://graph.threads.com/v1.0/me?fields=id,username', { headers: { Authorization: `Bearer ${r.access_token}` } }, options);
    if (typeof me.id !== 'string' || !/^[1-9]\d+$/.test(me.id)) throw new SocialApiError('Threads не подтвердил точный ID аккаунта.');
    accountId = me.id;
  } else if (id === 'instagram') {
    const body = new FormData();
    for (const [k, v] of Object.entries({ client_id: env.INSTAGRAM_CLIENT_ID, client_secret: env.INSTAGRAM_CLIENT_SECRET, grant_type: 'authorization_code', redirect_uri: p.redirectUri, code: params.code })) body.set(k, v);
    const response = await tokenRequest('https://api.instagram.com/oauth/access_token', { method: 'POST', body }, options);
    const short = Array.isArray(response.data) && response.data.length === 1 ? response.data[0] : response;
    requireScopes(short.permissions, p.scopes);
    if (!short.access_token || !short.user_id) throw new SocialApiError('Instagram не подтвердил аккаунт.');
    accountId = String(short.user_id);
    const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: env.INSTAGRAM_CLIENT_SECRET, access_token: short.access_token });
    r = await tokenRequest(`https://graph.instagram.com/access_token?${q}`, {}, options);
  } else {
    const fields = id === 'tiktok' ? { client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET }
      : { client_id: env.VK_CLIENT_ID, service_token: env.VK_SERVICE_TOKEN, device_id: params.device_id, state: params.state, code_verifier: verifier };
    r = await tokenRequest(id === 'tiktok' ? 'https://open.tiktokapis.com/v2/oauth/token/' : 'https://id.vk.ru/oauth2/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, grant_type: 'authorization_code', redirect_uri: p.redirectUri, code: params.code }),
    }, options);
    if (id === 'tiktok') requireScopes(r.scope, p.scopes);
    if (id === 'vk' && r.state !== params.state) throw new SocialApiError('VK не подтвердил состояние авторизации.');
    if (!r.refresh_token) throw new SocialApiError('Не выдан доступ для ежедневного обновления.');
    accountId = String((id === 'tiktok' ? r.open_id : r.user_id) || '');
  }
  if (!accountId || !Number.isSafeInteger(Number(r.expires_in)) || Number(r.expires_in) <= 0 || Number(r.expires_in) > 366 * 86400) throw new SocialApiError('Соцсеть не подтвердила срок или владельца доступа.');
  return { accountId, credentials: parseCredentials({ accessToken: r.access_token, refreshToken: r.refresh_token,
    ...(id === 'vk' ? { clientId: env.VK_CLIENT_ID, deviceId: params.device_id } : {}) }),
    expiresAt: new Date(Date.now() + Number(r.expires_in) * 1000).toISOString() };
}
