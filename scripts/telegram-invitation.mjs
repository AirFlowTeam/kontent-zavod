import { extractMessageUrls } from './telegram-bot-lib.mjs';

export function invitationFromMessage(message, botUsername) {
  const text = String(message?.text ?? message?.caption ?? '').trim();
  const raw = text.match(/^(?:\/start(?:@\w+)?\s+)?(c_[a-f0-9]{32,64})$/i)?.[1];
  if (raw) return { kind: 'invite', token: raw.slice(2).toLowerCase() };
  const candidates = new Set();
  for (const value of extractMessageUrls(message)) {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !['t.me', 'telegram.me', 'www.t.me'].includes(url.hostname)
      || url.pathname.replace(/\/$/, '').toLowerCase() !== `/${botUsername}`.toLowerCase()) continue;
    const payload = url.searchParams.get('start');
    candidates.add(payload ?? '');
  }
  if (candidates.size > 1) return { kind: 'multiple' };
  if (!candidates.size) {
    if (/^\/start(?:@\w+)?\s+\S+/i.test(text)) return { kind: 'invalid' };
    return null;
  }
  const payload = [...candidates][0];
  return /^c_[a-f0-9]{32,64}$/.test(payload) ? { kind: 'invite', token: payload.slice(2) } : { kind: 'invalid' };
}
