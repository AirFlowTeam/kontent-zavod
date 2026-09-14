'use client';
import type { Channel } from '@/lib/content-types';
import { socialInstructions } from '@/lib/social-instructions.mjs';
import { channelCoverage } from '@/lib/channel-sync-help.mjs';

export function SocialConnections({ channels }: { channels: Channel[] }) {
  return <div className="space-y-5">
    <div className="rounded-3xl border bg-card p-5"><h2 className="text-xl font-semibold">Подключение через Telegram</h2>
      <p className="mt-2 text-sm text-muted-foreground">Креатор открывает /channels → свой канал → «Подключить API». Бот выдаёт одноразовую защищённую форму на 10 минут. Доступ сохраняется за креатором и каналом; после проверки канал ставится в очередь, далее обновляется ежедневно. Администратор видит статусы, но не секреты.</p>
      <a className="inline-block mt-3 text-primary underline" href="https://t.me/contentlsbot" target="_blank" rel="noreferrer">Открыть бота</a>
    </div>
    {Object.entries(socialInstructions).map(([name, info]) => <details key={name} className="rounded-3xl border bg-card p-5">
      <summary className="cursor-pointer font-semibold">{info.title} · {channels.filter((c) => c.platformName === name).length} каналов</summary>
      <ol className="list-decimal pl-5 space-y-3 mt-4 text-sm">{info.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <a className="inline-block mt-4 text-primary underline text-sm" href={info.docs} target="_blank" rel="noreferrer">Официальная инструкция</a>
    </details>)}
    <div className="rounded-3xl border bg-card p-5 overflow-x-auto"><h2 className="text-xl font-semibold mb-4">Доступы и состояние каналов</h2><table className="w-full text-sm text-left"><thead><tr className="border-b">{['Креатор / канал', 'Доступ', 'Срок', 'Последний сбор'].map((s) => <th key={s} className="p-3 font-medium">{s}</th>)}</tr></thead><tbody>
      {channels.map((c) => <tr key={c.id} className="border-b last:border-0"><td className="p-3"><div className="font-medium">{c.creatorName} · {c.platformName}</div><a className="text-primary break-all" href={c.url} target="_blank" rel="noreferrer">{c.url}</a></td>
        <td className="p-3">{c.connectionStatus === 'needs_auth' ? 'Переподключить в боте' : c.connectionStatus === 'connected' ? `Подключён: ${c.connectionUsername}` : c.platformName === 'RuTube' ? 'Ключ не нужен' : 'Персональный доступ не подключён'}</td>
        <td className="p-3">{c.connectionExpiresAt ? new Date(c.connectionExpiresAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : c.connectionStatus ? 'Не подтверждён API' : '—'}</td>
        <td className="p-3">{c.lastSyncStatus === 'success' ? [c.effectiveTotalViews, c.effectivePublicationCount, c.effectiveTotalLikes].every((v) => v !== null) ? 'Данные получены' : 'Частичные данные' : c.lastSyncStatus === 'needs_auth' ? 'Нужен доступ' : c.lastSyncStatus === 'error' ? 'Ошибка, повторим' : 'В очереди'}{channelCoverage(c.parserSource) && <p className="mt-1 text-xs text-amber-700 max-w-sm">{channelCoverage(c.parserSource)}</p>}</td></tr>)}
    </tbody></table></div>
  </div>;
}
