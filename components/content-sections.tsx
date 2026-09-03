'use client';

import {
  ArrowRight,
  Bot,
  CircleUserRound,
  ExternalLink,
  Film,
  Pencil,
  Plus,
  Radio,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatNumber } from '@/lib/content-metrics';
import type { CreatorType, Metrics, Producer, SummaryRow, Video } from '@/lib/content-types';

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="grid min-h-48 place-items-center px-6 py-10 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground"><Radio className="size-4" /></div>
        <p className="mt-3 font-bold">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function MetricCards({ metrics }: { metrics: Metrics }) {
  const items = [
    { label: 'Креаторов', value: formatNumber(metrics.creatorCount), note: 'в текущей выборке', icon: UserRoundCheck },
    { label: 'Роликов', value: formatNumber(metrics.videoCount), note: 'уникальных ссылок', icon: Film },
    { label: 'Общий охват', value: formatNumber(metrics.reach), note: 'сумма по роликам', icon: Radio, featured: true },
    { label: 'Средний охват', value: metrics.videoCount ? formatNumber(metrics.average) : '—', note: 'на один ролик', icon: UsersRound },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
      {items.map((item) => (
        <article key={item.label} className={`metric-card rounded-2xl border bg-card p-5 ${item.featured ? 'border-primary/35 bg-primary/[0.035]' : 'border-border/80'}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-bold text-muted-foreground">{item.label}</p>
            <div className={`grid size-8 place-items-center rounded-lg ${item.featured ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}><item.icon className="size-4" /></div>
          </div>
          <p className="mt-5 text-[1.75rem] font-extrabold tracking-[-0.045em] tabular-nums">{item.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
        </article>
      ))}
    </div>
  );
}

function TypeCard({ type, metrics, muted, onOpen }: { type: CreatorType; metrics: Metrics; muted?: boolean; onOpen: () => void }) {
  const isAI = type === 'AI';
  return (
    <article className={`relative overflow-hidden rounded-3xl p-6 ${isAI ? 'bg-[var(--ai-surface)] text-[var(--ai-foreground)]' : 'bg-[var(--ugc-surface)] text-[var(--ugc-foreground)]'} ${muted ? 'opacity-45 grayscale-[25%]' : ''}`}>
      <div className={`absolute size-44 rounded-full border-[28px] opacity-15 ${isAI ? '-bottom-20 -right-8 border-black' : '-right-12 -top-20 border-white'}`} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <Badge className={isAI ? 'bg-white/50 text-[var(--ai-foreground)]' : 'bg-white/16 text-white'}>{type}</Badge>
          {muted && <span className="text-[11px] font-semibold opacity-70">Исключено фильтром</span>}
        </div>
        <p className={`mt-8 text-sm font-semibold ${isAI ? 'opacity-60' : 'text-white/65'}`}>{formatNumber(metrics.creatorCount)} креаторов · {formatNumber(metrics.videoCount)} роликов</p>
        <p className="mt-1 text-[1.7rem] font-extrabold tracking-[-0.045em] tabular-nums">{formatNumber(metrics.reach)} охвата</p>
        <div className={`mt-5 flex items-center justify-between border-t pt-4 text-sm ${isAI ? 'border-black/10' : 'border-white/15'}`}>
          <span className={isAI ? 'opacity-60' : 'text-white/65'}>Средний охват</span>
          <strong className="tabular-nums">{metrics.videoCount ? formatNumber(metrics.average) : '—'}</strong>
        </div>
        <button onClick={onOpen} className={`mt-5 inline-flex items-center gap-2 text-xs font-bold ${isAI ? 'text-[var(--ai-foreground)]' : 'text-white'}`}>
          Смотреть креаторов <ArrowRight className="size-3.5" />
        </button>
      </div>
    </article>
  );
}

export function CreatorTable({ rows, onCreator, title = 'Результаты креаторов', subtitle = 'По текущей выборке' }: { rows: SummaryRow[]; onCreator: (id: number) => void; title?: string; subtitle?: string }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-border/80 bg-card">
      <div className="px-5 py-4 sm:px-6">
        <h2 className="font-bold tracking-[-0.02em]">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {rows.length === 0 ? <EmptyState title="Нет креаторов с публикациями" description="Измените фильтры или добавьте новый ролик." /> : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-y border-border bg-muted/45 text-left text-xs text-muted-foreground">
                <tr><th className="px-6 py-3 font-semibold">Креатор</th><th className="px-4 py-3 font-semibold">Тип</th><th className="px-4 py-3 font-semibold">Продюсер</th><th className="px-4 py-3 text-right font-semibold">Роликов</th><th className="px-4 py-3 text-right font-semibold">Общий охват</th><th className="px-6 py-3 text-right font-semibold">Средний</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/70 last:border-0 hover:bg-muted/35">
                    <td className="px-6 py-4"><button onClick={() => onCreator(row.id)} className="font-bold hover:text-primary hover:underline hover:underline-offset-4">{row.name}</button></td>
                    <td className="px-4 py-4"><TypeBadge type={row.type!} /></td>
                    <td className="px-4 py-4 text-muted-foreground">{row.producerName}</td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums">{formatNumber(row.videoCount)}</td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums">{formatNumber(row.reach)}</td>
                    <td className="px-6 py-4 text-right text-muted-foreground tabular-nums">{row.videoCount ? formatNumber(row.average) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {rows.map((row) => (
              <button key={row.id} onClick={() => onCreator(row.id)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/40">
                <div><div className="flex items-center gap-2"><span className="font-bold">{row.name}</span><TypeBadge type={row.type!} /></div><p className="mt-1 text-xs text-muted-foreground">{row.producerName} · {formatNumber(row.videoCount)} роликов</p></div>
                <div className="text-right"><p className="font-bold tabular-nums">{formatNumber(row.reach)}</p><p className="text-[11px] text-muted-foreground">охват</p></div>
              </button>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

export function TypeBadge({ type }: { type: CreatorType }) {
  return <Badge variant="secondary" className={type === 'AI' ? 'bg-[var(--ai-soft)] text-[var(--ai-ink)]' : 'bg-[var(--ugc-soft)] text-[var(--ugc-ink)]'}>{type}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Активен</Badge>;
  if (status === 'error') return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Ошибка</Badge>;
  if (status === 'deleted') return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Удалён</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Неактивен</Badge>;
}

export function DashboardSection({ metrics, ugc, ai, creatorRows, producerRows, typeFilter, onViewType, onCreator, onProducer }: {
  metrics: Metrics; ugc: Metrics; ai: Metrics; creatorRows: SummaryRow[]; producerRows: SummaryRow[]; typeFilter: '' | CreatorType;
  onViewType: (type: CreatorType) => void; onCreator: (id: number) => void; onProducer: (id: number) => void;
}) {
  return (
    <div className="space-y-5">
      <MetricCards metrics={metrics} />
      <div className="grid gap-4 2xl:grid-cols-12">
        <div className="2xl:col-span-3"><TypeCard type="UGC" metrics={ugc} muted={typeFilter === 'AI'} onOpen={() => onViewType('UGC')} /></div>
        <div className="2xl:col-span-3"><TypeCard type="AI" metrics={ai} muted={typeFilter === 'UGC'} onOpen={() => onViewType('AI')} /></div>
        <article className="overflow-hidden rounded-3xl border border-border/80 bg-card 2xl:col-span-6">
          <div className="flex items-center justify-between px-5 py-4 sm:px-6"><div><h2 className="font-bold">По продюсерам</h2><p className="mt-0.5 text-xs text-muted-foreground">Ответственные и результат команды</p></div><UsersRound className="size-4 text-muted-foreground" /></div>
          {producerRows.length === 0 ? <EmptyState title="Нет данных" description="В выборке пока нет публикаций." /> : <div className="divide-y divide-border border-t border-border">
            {producerRows.slice(0, 4).map((row) => (
              <button key={row.id} onClick={() => onProducer(row.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-3 text-left hover:bg-muted/40 sm:px-6">
                <div className="min-w-0"><p className="truncate text-sm font-bold">{row.name}</p><p className="text-[11px] text-muted-foreground">{formatNumber(row.creatorCount ?? 0)} креаторов</p></div>
                <div className="text-right"><p className="text-sm font-bold tabular-nums">{formatNumber(row.videoCount)}</p><p className="text-[10px] text-muted-foreground">роликов</p></div>
                <div className="min-w-24 text-right"><p className="text-sm font-bold tabular-nums">{formatNumber(row.reach)}</p><p className="text-[10px] text-muted-foreground">охват</p></div>
              </button>
            ))}
          </div>}
        </article>
      </div>
      <CreatorTable rows={creatorRows} onCreator={onCreator} />
    </div>
  );
}

export function CreatorTypeSection({ type, metrics, rows, onCreator }: { type: CreatorType; metrics: Metrics; rows: SummaryRow[]; onCreator: (id: number) => void }) {
  return <div className="space-y-5"><MetricCards metrics={metrics} /><CreatorTable rows={rows} onCreator={onCreator} title={`${type}-креаторы`} subtitle={`Все креаторы типа ${type} в текущей выборке`} /></div>;
}

export function VideosSection({ videos, activeMetrics, onEdit, onAdd }: { videos: Video[]; activeMetrics: Metrics; onEdit: (video: Video) => void; onAdd: () => void }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-border/80 bg-card">
      <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
        <div><h2 className="font-bold">Все ролики</h2><p className="mt-0.5 text-xs text-muted-foreground">{formatNumber(activeMetrics.videoCount)} активных · {formatNumber(activeMetrics.reach)} охвата</p></div>
        <Button size="sm" onClick={onAdd}><Plus data-icon="inline-start" /> Добавить</Button>
      </div>
      {videos.length === 0 ? <EmptyState title="За этот период роликов нет" description="Сбросьте фильтры или добавьте первую публикацию." action={<Button onClick={onAdd}>Добавить ролик</Button>} /> : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[940px] text-sm">
              <thead className="border-y border-border bg-muted/45 text-left text-xs text-muted-foreground"><tr><th className="px-6 py-3 font-semibold">Дата</th><th className="px-4 py-3 font-semibold">Креатор</th><th className="px-4 py-3 font-semibold">Тип</th><th className="px-4 py-3 font-semibold">Продюсер</th><th className="px-4 py-3 font-semibold">Площадка</th><th className="px-4 py-3 font-semibold">Ссылка</th><th className="px-4 py-3 text-right font-semibold">Охват</th><th className="px-4 py-3 font-semibold">Статус</th><th className="px-6 py-3"><span className="sr-only">Действия</span></th></tr></thead>
              <tbody>{videos.map((video) => <tr key={video.id} className="border-b border-border/70 last:border-0 hover:bg-muted/35">
                <td className="px-6 py-4 text-muted-foreground">{formatDate(video.publishedAt)}</td><td className="px-4 py-4 font-bold">{video.creatorName}</td><td className="px-4 py-4"><TypeBadge type={video.creatorType} /></td><td className="px-4 py-4 text-muted-foreground">{video.producerName}</td><td className="px-4 py-4">{video.platformName}</td>
                <td className="px-4 py-4"><a href={video.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">Открыть <ExternalLink className="size-3" /></a></td>
                <td className="px-4 py-4 text-right font-bold tabular-nums">{formatNumber(video.reach)}</td><td className="px-4 py-4"><StatusBadge status={video.status} /></td><td className="px-6 py-4 text-right"><Button variant="ghost" size="icon-sm" onClick={() => onEdit(video)} aria-label={`Редактировать ролик ${video.creatorName}`}><Pencil /></Button></td>
              </tr>)}</tbody>
              <tfoot className="border-t border-border bg-muted/35"><tr><td colSpan={6} className="px-6 py-4 font-bold">Итого по активным публикациям</td><td className="px-4 py-4 text-right font-extrabold tabular-nums">{formatNumber(activeMetrics.reach)}</td><td colSpan={2} className="px-6 py-4 text-right text-xs text-muted-foreground">{formatNumber(activeMetrics.videoCount)} роликов</td></tr></tfoot>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">{videos.map((video) => <article key={video.id} className="px-5 py-4">
            <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="font-bold">{video.creatorName}</span><TypeBadge type={video.creatorType} /></div><p className="mt-1 text-xs text-muted-foreground">{formatDate(video.publishedAt)} · {video.platformName}</p></div><Button variant="ghost" size="icon-sm" onClick={() => onEdit(video)}><Pencil /></Button></div>
            <div className="mt-4 flex items-center justify-between"><a href={video.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">Открыть ролик <ExternalLink className="size-3" /></a><div className="text-right"><p className="font-extrabold tabular-nums">{formatNumber(video.reach)}</p><StatusBadge status={video.status} /></div></div>
          </article>)}</div>
        </>
      )}
    </article>
  );
}

export function ProducersSection({ producers, rows, onProducer, onEdit, onAdd }: { producers: Producer[]; rows: SummaryRow[]; onProducer: (id: number) => void; onEdit: (producer: Producer) => void; onAdd: () => void }) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return (
    <article className="overflow-hidden rounded-3xl border border-border/80 bg-card">
      <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"><div><h2 className="font-bold">Продюсеры</h2><p className="mt-0.5 text-xs text-muted-foreground">Ответственные и результаты их креаторов</p></div><Button size="sm" onClick={onAdd}><Plus data-icon="inline-start" /> Добавить</Button></div>
      {producers.length === 0 ? <EmptyState title="Продюсеров пока нет" description="Добавьте первого продюсера, чтобы закреплять за ним креаторов." /> : <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-3 sm:p-5">{producers.map((producer) => {
        const row = byId.get(producer.id) ?? { id: producer.id, name: producer.name, creatorCount: 0, videoCount: 0, reach: 0, average: 0 };
        return <article key={producer.id} className="rounded-2xl border border-border bg-background/60 p-5 hover:border-primary/25">
          <div className="flex items-start justify-between"><button onClick={() => onProducer(producer.id)} className="text-left"><p className="text-lg font-extrabold tracking-[-0.03em] hover:text-primary">{producer.name}</p><div className="mt-2"><StatusBadge status={producer.status} /></div></button><Button variant="ghost" size="icon-sm" onClick={() => onEdit(producer)} aria-label={`Редактировать продюсера ${producer.name}`}><Pencil /></Button></div>
          <div className="mt-6 grid grid-cols-2 gap-4"><div><p className="text-xs text-muted-foreground">Креаторов</p><p className="mt-1 text-xl font-extrabold tabular-nums">{formatNumber(row.creatorCount ?? 0)}</p></div><div><p className="text-xs text-muted-foreground">Роликов</p><p className="mt-1 text-xl font-extrabold tabular-nums">{formatNumber(row.videoCount)}</p></div><div className="col-span-2 border-t border-border pt-4"><p className="text-xs text-muted-foreground">Общий охват</p><p className="mt-1 text-xl font-extrabold tabular-nums">{formatNumber(row.reach)}</p></div></div>
        </article>;
      })}</div>}
    </article>
  );
}

export function CreatorSectionIcon({ type }: { type: CreatorType }) {
  return type === 'AI' ? <Bot className="size-5" /> : <CircleUserRound className="size-5" />;
}
