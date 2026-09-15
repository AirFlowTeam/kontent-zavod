'use client';
import { useEffect, useState } from 'react';
import type { Channel } from '@/lib/content-types';
import { socialInstructions } from '@/lib/social-instructions.mjs';
import { channelCoverage } from '@/lib/channel-sync-help.mjs';

export function SocialConnections({ channels }: { channels: Channel[] }) {
  const [setup, setSetup] = useState<{ providers: { id: string; platform: string; ready: boolean; missing: string[]; status: string; callbackUrl: string | null; scopes: string[]; enableVariable: string | null }[]; guideUrl: string | null; productUrl: string | null; privacyUrl: string | null; termsUrl: string | null; deletionUrl: string | null; note: string } | null>(null);
  const [setupError, setSetupError] = useState(false);
  useEffect(() => {
    let active = true;
    const read = async () => { try { const r = await fetch('/api/integrations', { cache: 'no-store' }); if (!r.ok) throw new Error(); const d = await r.json() as NonNullable<typeof setup>; if (!Array.isArray(d.providers)) throw new Error(); if (active) { setSetup(d); setSetupError(false); } } catch { if (active) setSetupError(true); } };
    void read(); const timer = setInterval(() => { void read(); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <div className="space-y-5">
    <div className="rounded-3xl border bg-card p-5"><h2 className="text-xl font-semibold">Подключение через Telegram</h2>
      <p className="mt-2 text-sm text-muted-foreground">Креатор открывает /channels → свой канал → «Подключить API» → официальный вход в соцсеть. Ключи сохраняются автоматически за креатором и каналом. Первая проверка — после подключения, далее ежедневно. Ручной ввод готовых токенов остаётся дополнительным вариантом. API вводят только сами креаторы в своих персональных формах; продюсеры не загружают чужие ключи. В боте /guide — пошаговый старт, /api — подключение. Поддерживается Threads; RuTube работает без ключа.</p>
      <a className="inline-block mt-3 text-primary underline" href="https://t.me/contentlsbot" target="_blank" rel="noreferrer">Открыть бота</a>
      <a className="inline-block mt-3 ml-5 text-primary underline" href={setup?.guideUrl || '/api-guide'} target="_blank" rel="noreferrer">Гайд для рассылки креаторам</a>
    </div>
    <section className="rounded-3xl border bg-card p-5"><h2 className="text-xl font-semibold">Готовность приложений</h2>
      <a href="/api/integrations/guide" className="inline-block mt-2 text-primary underline text-sm">Скачать пошаговый гайд администратора</a>
      <p className="text-sm text-muted-foreground mt-2">Секреты вводятся только на сервере. Здесь показаны настройки, которые нужно заполнить администратору. Обычному креатору создавать приложение не нужно.</p>
      {setupError && <p role="alert" className="mt-3 text-sm text-amber-700">Не удалось обновить состояние настроек. Повторим автоматически.</p>}
      {!setup && !setupError && <p className="mt-3">Проверяем настройки…</p>}
      <div className="grid gap-4 mt-4 md:grid-cols-2">{setup?.providers.map((p) => <div key={p.id} className="border rounded-2xl p-4 min-w-0">
        <h3 className="font-semibold">{p.platform}</h3><p className={`mt-1 text-sm ${p.ready ? 'text-muted-foreground' : 'text-amber-700'}`}>{p.status}</p>
        {p.missing.length > 0 && <p className="mt-3 text-sm break-all">Заполнить: <code>{p.missing.join(', ')}</code></p>}
        {p.callbackUrl && <div className="mt-3"><label className="text-sm block" htmlFor={`redirect-${p.id}`}>Redirect URI — скопируйте без изменений</label><input id={`redirect-${p.id}`} readOnly value={p.callbackUrl} onFocus={(e) => e.currentTarget.select()} className="w-full border rounded-lg p-2 mt-1 text-sm bg-background" /></div>}
        {p.scopes.length > 0 && <p className="mt-2 text-sm break-words">Разрешения: <code>{p.scopes.join(', ')}</code></p>}
        {p.enableVariable && <p className="mt-2 text-sm text-muted-foreground">После настройки и разрешения площадки: <code>{p.enableVariable}=true</code></p>}
      </div>)}</div>
      {setup && <><p className="mt-4 text-sm text-muted-foreground">{setup.note}</p><p className="mt-3 flex flex-wrap gap-4 text-sm">{[[setup.productUrl, 'О сервисе'], [setup.privacyUrl, 'Конфиденциальность'], [setup.termsUrl, 'Условия'], [setup.deletionUrl, 'Удаление данных']].map(([url, label]) => url && <a key={label} href={url} target="_blank" rel="noreferrer" className="text-primary underline">{label}</a>)}</p></>}
    </section>
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
