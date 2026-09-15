import { env } from 'cloudflare:workers';
import { parseTelegramAdminUserIds } from '@/scripts/telegram-bot-lib.mjs';

export function isTelegramAdmin(id: unknown) {
  if (typeof id !== 'string' && typeof id !== 'number') return false;
  try { return parseTelegramAdminUserIds(Reflect.get(env, 'TELEGRAM_ADMIN_USER_IDS')).has(String(id)); }
  catch { return false; } // Misconfiguration must never grant extra privileges.
}
