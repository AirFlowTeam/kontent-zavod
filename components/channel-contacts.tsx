import type { Channel } from '@/lib/content-types';

export function ChannelContacts({ channel }: { channel: Channel }) {
  return <div className="mt-2 space-y-1 text-xs text-muted-foreground">
    {[
      ['Креатор', channel.creatorTelegramId, channel.creatorTelegramUsername],
      ['Продюсер', channel.producerTelegramId, channel.producerTelegramUsername],
    ].map(([label, id, username]) => <p key={label} className="break-words">
      {label}: {id ? <a className="text-primary hover:underline" href={username ? `https://t.me/${username}` : `tg://user?id=${id}`} target="_blank" rel="noopener noreferrer">
        {username ? `@${username}` : `Telegram ID ${id}`}
      </a> : <span className="text-amber-700">Telegram не привязан</span>}
    </p>)}
  </div>;
}
