'use client';
import { useState } from 'react';
import type { TelegramAccount } from '@/lib/content-types';
import { Input } from '@/components/ui/input';

function contact(id: string | null, username: string | null) {
  return id ? <a className="text-primary break-all" href={username ? `https://t.me/${username}` : `tg://user?id=${id}`} target="_blank" rel="noreferrer">{username ? `@${username}` : id}</a> : '—';
}

export function TelegramAccounts({ accounts }: { accounts: TelegramAccount[] }) {
  const [query, setQuery] = useState('');
  const rows = accounts.filter((a) => [a.displayName, a.username, a.telegramUserId, a.producerName].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <section className="rounded-3xl border bg-card p-5 space-y-4">
    <div><h2 className="text-xl font-semibold">Все пользователи Telegram · {accounts.length}</h2>
      <p className="text-sm text-muted-foreground">Включая тех, кто только запустил бота. Общий реестр не зависит от фильтров каналов.</p></div>
    <Input aria-label="Поиск пользователя Telegram" placeholder="Имя, @username, Telegram ID или продюсер" value={query} onChange={(e) => setQuery(e.target.value)} />
    <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="border-b text-muted-foreground">
      {['Пользователь', 'Telegram', 'Этап', 'Тип', 'Продюсер', 'Каналы', 'Регистрация'].map((title) => <th className="p-3 font-medium" key={title}>{title}</th>)}
    </tr></thead><tbody>{rows.map((a) => <tr className="border-b last:border-0" key={a.telegramUserId}>
      <td className="p-3 font-medium">{a.displayName || a.username || 'Без имени'}</td>
      <td className="p-3">{contact(a.telegramUserId, a.username)}{a.username && <div className="text-xs text-muted-foreground">{a.telegramUserId}</div>}</td>
      <td className="p-3">{a.stage}{a.creatorId && a.channelCount === 0 && <div className="text-xs text-muted-foreground">Пока без каналов</div>}</td>
      <td className="p-3">{a.selectedType === 'AI' ? 'ИИ' : a.selectedType || '—'}</td>
      <td className="p-3">{a.producerName || '—'}<div>{contact(a.producerTelegramId, a.producerTelegramUsername)}</div></td>
      <td className="p-3">{a.channelCount}</td><td className="p-3 whitespace-nowrap">{new Date(a.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</td>
    </tr>)}</tbody></table>{!rows.length && <p className="py-6 text-muted-foreground">Пользователей не найдено.</p>}</div>
  </section>;
}
