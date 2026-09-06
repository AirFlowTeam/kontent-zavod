'use client';

import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleOff,
  CircleUserRound,
  Clock3,
  ExternalLink,
  Eye,
  KeyRound,
  Link2,
  LoaderCircle,
  Newspaper,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  effectiveChannelMetrics,
  formatDateTime,
  formatNumber,
  formatRelativeSync,
  getFreshness,
} from '@/lib/content-metrics';
import type {
  Channel,
  ChannelSyncStatus,
  Creator,
  CreatorType,
  Metrics,
  Producer,
  RecordStatus,
  SummaryRow,
} from '@/lib/content-types';

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-48 place-items-center px-6 py-10 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Radio className="size-4" />
        </div>
        <p className="mt-3 font-bold">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

function Reach30d({ value, coverage }: { value: number; coverage: number }) {
  return coverage ? (
    <>{formatNumber(value)}</>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

function formatAvailable(value: number, coverage: number) {
  return coverage ? formatNumber(value) : '—';
}

function formatChannelMetric(value: number | null) {
  return value === null ? '—' : formatNumber(value);
}

export function MetricCards({ metrics }: { metrics: Metrics }) {
  const items = [
    {
      label: 'Каналов',
      value: formatNumber(metrics.channelCount),
      note: `${formatNumber(metrics.creatorCount)} креаторов`,
      icon: Link2,
    },
    {
      label: 'Подписчиков',
      value: formatAvailable(metrics.followers, metrics.followersCount),
      note: metrics.followersCount
        ? `данные ${metrics.followersCount} из ${metrics.channelCount}`
        : 'данные ещё не получены',
      icon: UserRoundCheck,
    },
    {
      label: 'Охваты каналов',
      value: formatAvailable(metrics.totalViews, metrics.totalViewsCount),
      note: metrics.totalViewsCount
        ? `данные ${metrics.totalViewsCount} из ${metrics.channelCount}`
        : 'данные ещё не получены',
      icon: Eye,
      featured: true,
    },
    {
      label: 'Публикаций',
      value: formatAvailable(
        metrics.publicationCount,
        metrics.publicationCountCount,
      ),
      note: metrics.publicationCountCount
        ? `данные ${metrics.publicationCountCount} из ${metrics.channelCount}`
        : 'данные ещё не получены',
      icon: Newspaper,
    },
    {
      label: 'Охват за 30 дней',
      value: metrics.reach30dCount ? formatNumber(metrics.reach30d) : '—',
      note: metrics.reach30dCount
        ? `доступно для ${formatNumber(metrics.reach30dCount)} каналов`
        : 'площадки не передали данные',
      icon: RefreshCw,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <article
          key={item.label}
          className={`metric-card min-w-0 rounded-2xl border bg-card p-5 ${item.featured ? 'border-primary/35 bg-primary/[0.035]' : 'border-border/80'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-bold text-muted-foreground">
              {item.label}
            </p>
            <div
              className={`grid size-8 shrink-0 place-items-center rounded-lg ${item.featured ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              <item.icon className="size-4" />
            </div>
          </div>
          <p
            className="mt-5 truncate text-[1.65rem] font-extrabold tracking-[-0.045em] tabular-nums"
            title={item.value}
          >
            {item.value}
          </p>
          <p
            className="mt-1 truncate text-xs text-muted-foreground"
            title={item.note}
          >
            {item.note}
          </p>
        </article>
      ))}
    </div>
  );
}

function TypeCard({
  type,
  metrics,
  muted,
  onOpen,
}: {
  type: CreatorType;
  metrics: Metrics;
  muted?: boolean;
  onOpen: () => void;
}) {
  const isAI = type === 'AI';
  return (
    <article
      className={`relative overflow-hidden rounded-3xl p-6 ${isAI ? 'bg-[var(--ai-surface)] text-[var(--ai-foreground)]' : 'bg-[var(--ugc-surface)] text-[var(--ugc-foreground)]'} ${muted ? 'opacity-45 grayscale-[25%]' : ''}`}
    >
      <div
        className={`absolute size-44 rounded-full border-[28px] opacity-15 ${isAI ? '-bottom-20 -right-8 border-black' : '-right-12 -top-20 border-white'}`}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <Badge
            className={
              isAI
                ? 'bg-white/50 text-[var(--ai-foreground)]'
                : 'bg-white/16 text-white'
            }
          >
            {type}
          </Badge>
          {muted && (
            <span className="text-[11px] font-semibold opacity-70">
              Исключено фильтром
            </span>
          )}
        </div>
        <p
          className={`mt-8 text-sm font-semibold ${isAI ? 'opacity-60' : 'text-white/65'}`}
        >
          {formatNumber(metrics.creatorCount)} креаторов ·{' '}
          {formatNumber(metrics.channelCount)} каналов
        </p>
        <p className="mt-1 text-[1.7rem] font-extrabold tracking-[-0.045em] tabular-nums">
          {formatAvailable(metrics.totalViews, metrics.totalViewsCount)} охватов
        </p>
        <div
          className={`mt-5 flex items-center justify-between border-t pt-4 text-sm ${isAI ? 'border-black/10' : 'border-white/15'}`}
        >
          <span className={isAI ? 'opacity-60' : 'text-white/65'}>
            Подписчики
          </span>
          <strong className="tabular-nums">
            {formatAvailable(metrics.followers, metrics.followersCount)}
          </strong>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className={`mt-5 inline-flex items-center gap-2 text-xs font-bold ${isAI ? 'text-[var(--ai-foreground)]' : 'text-white'}`}
        >
          Смотреть креаторов <ArrowRight className="size-3.5" />
        </button>
      </div>
    </article>
  );
}

export function TypeBadge({ type }: { type: CreatorType }) {
  return (
    <Badge
      variant="secondary"
      className={
        type === 'AI'
          ? 'bg-[var(--ai-soft)] text-[var(--ai-ink)]'
          : 'bg-[var(--ugc-soft)] text-[var(--ugc-ink)]'
      }
    >
      {type}
    </Badge>
  );
}

export function RecordStatusBadge({ status }: { status: RecordStatus }) {
  return status === 'active' ? (
    <Badge
      variant="outline"
      className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    >
      Активен
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Неактивен
    </Badge>
  );
}

const syncCopy: Record<
  ChannelSyncStatus,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  success: {
    label: 'Синхронизирован',
    icon: CheckCircle2,
    className:
      'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  pending: {
    label: 'В очереди',
    icon: Clock3,
    className: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  syncing: {
    label: 'Обновляется',
    icon: LoaderCircle,
    className: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  error: {
    label: 'Ошибка',
    icon: AlertTriangle,
    className:
      'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  needs_auth: {
    label: 'Нужен доступ',
    icon: KeyRound,
    className:
      'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  },
};

export function SyncStatusBadge({
  status,
}: {
  status: ChannelSyncStatus | null;
}) {
  if (!status)
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleOff />
        Нет синхронизации
      </Badge>
    );
  const item = syncCopy[status];
  return (
    <Badge variant="outline" className={item.className}>
      <item.icon
        className={status === 'syncing' ? 'animate-spin' : undefined}
      />
      {item.label}
    </Badge>
  );
}

export function FreshnessBadge({ lastSyncAt }: { lastSyncAt: string | null }) {
  const freshness = getFreshness(lastSyncAt);
  const copy = {
    fresh: {
      label: 'Свежие',
      className:
        'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    },
    aging: {
      label: 'Обновлялись недавно',
      className:
        'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    },
    stale: {
      label: 'Данные устарели',
      className:
        'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    },
    never: { label: 'Данных пока нет', className: 'text-muted-foreground' },
  }[freshness];
  return (
    <Badge variant="outline" className={copy.className}>
      <Clock3 />
      {copy.label}
    </Badge>
  );
}

export function CreatorTable({
  rows,
  onCreator,
  title = 'Креаторы',
  subtitle = 'Агрегаты по каналам текущей выборки',
}: {
  rows: SummaryRow[];
  onCreator: (id: number) => void;
  title?: string;
  subtitle?: string;
}) {
  return (
    <article className="overflow-hidden rounded-3xl border border-border/80 bg-card">
      <div className="px-5 py-4 sm:px-6">
        <h2 className="font-bold tracking-[-0.02em]">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Каналы не найдены"
          description="Измените фильтры или добавьте канал креатора по ссылке."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-y border-border bg-muted/45 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-semibold">Креатор</th>
                  <th className="px-4 py-3 font-semibold">Тип</th>
                  <th className="px-4 py-3 font-semibold">Продюсер</th>
                  <th className="px-4 py-3 text-right font-semibold">Каналы</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Подписчики
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">Охваты</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    30 дней
                  </th>
                  <th className="px-6 py-3 text-right font-semibold">
                    Публикации
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/70 last:border-0 hover:bg-muted/35"
                  >
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => onCreator(row.id)}
                        className="font-bold hover:text-primary hover:underline hover:underline-offset-4"
                      >
                        {row.name}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <TypeBadge type={row.type!} />
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {row.producerName}
                    </td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums">
                      {formatNumber(row.channelCount)}
                    </td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums">
                      {formatAvailable(row.followers, row.followersCount)}
                    </td>
                    <td className="px-4 py-4 text-right font-bold tabular-nums">
                      {formatAvailable(row.totalViews, row.totalViewsCount)}
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums">
                      <Reach30d
                        value={row.reach30d}
                        coverage={row.reach30dCount}
                      />
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums">
                      {formatAvailable(
                        row.publicationCount,
                        row.publicationCountCount,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                aria-label={`Открыть карточку креатора ${row.name}`}
                onClick={() => onCreator(row.id)}
                className="block w-full px-5 py-4 text-left hover:bg-muted/40"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-bold">{row.name}</span>
                      <TypeBadge type={row.type!} />
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {row.producerName} · {formatNumber(row.channelCount)}{' '}
                      каналов
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold tabular-nums">
                      {formatAvailable(row.totalViews, row.totalViewsCount)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">охваты</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Подписчики</p>
                    <p className="mt-0.5 font-semibold tabular-nums">
                      {formatAvailable(row.followers, row.followersCount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Публикации</p>
                    <p className="mt-0.5 font-semibold tabular-nums">
                      {formatAvailable(
                        row.publicationCount,
                        row.publicationCountCount,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">30 дней</p>
                    <p className="mt-0.5 font-semibold tabular-nums">
                      <Reach30d
                        value={row.reach30d}
                        coverage={row.reach30dCount}
                      />
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

export function DashboardSection({
  metrics,
  ugc,
  ai,
  creatorRows,
  producerRows,
  typeFilter,
  onViewType,
  onCreator,
  onProducer,
}: {
  metrics: Metrics;
  ugc: Metrics;
  ai: Metrics;
  creatorRows: SummaryRow[];
  producerRows: SummaryRow[];
  typeFilter: '' | CreatorType;
  onViewType: (type: CreatorType) => void;
  onCreator: (id: number) => void;
  onProducer: (id: number) => void;
}) {
  return (
    <div className="space-y-5">
      <MetricCards metrics={metrics} />
      <div className="grid gap-4 2xl:grid-cols-12">
        <div className="2xl:col-span-3">
          <TypeCard
            type="UGC"
            metrics={ugc}
            muted={typeFilter === 'AI'}
            onOpen={() => onViewType('UGC')}
          />
        </div>
        <div className="2xl:col-span-3">
          <TypeCard
            type="AI"
            metrics={ai}
            muted={typeFilter === 'UGC'}
            onOpen={() => onViewType('AI')}
          />
        </div>
        <article className="overflow-hidden rounded-3xl border border-border/80 bg-card 2xl:col-span-6">
          <div className="flex items-center justify-between px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-bold">По продюсерам</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Каналы и охваты команд
              </p>
            </div>
            <UsersRound className="size-4 text-muted-foreground" />
          </div>
          {producerRows.length === 0 ? (
            <EmptyState
              title="Нет данных"
              description="В текущей выборке нет каналов."
            />
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {producerRows.slice(0, 4).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  aria-label={`Открыть карточку продюсера ${row.name}`}
                  onClick={() => onProducer(row.id)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-3 text-left hover:bg-muted/40 sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{row.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatNumber(row.creatorCount ?? 0)} креаторов
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums">
                      {formatNumber(row.channelCount)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">каналов</p>
                  </div>
                  <div className="min-w-24 text-right">
                    <p className="text-sm font-bold tabular-nums">
                      {formatAvailable(row.totalViews, row.totalViewsCount)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">охваты</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </article>
      </div>
      <CreatorTable rows={creatorRows} onCreator={onCreator} />
    </div>
  );
}

export function CreatorTypeSection({
  type,
  metrics,
  rows,
  onCreator,
}: {
  type: CreatorType;
  metrics: Metrics;
  rows: SummaryRow[];
  onCreator: (id: number) => void;
}) {
  return (
    <div className="space-y-5">
      <MetricCards metrics={metrics} />
      <CreatorTable
        rows={rows}
        onCreator={onCreator}
        title={`${type}-креаторы`}
        subtitle={`Метрики ${type}-креаторов рассчитаны только по каналам текущей выборки`}
      />
    </div>
  );
}

function ChannelIdentity({
  channel,
  onOpen,
}: {
  channel: Channel;
  onOpen: () => void;
}) {
  const name = channel.title || channel.handle || channel.platformName;
  const fallback = name.trim().slice(0, 2).toUpperCase();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar>
        <AvatarImage src={channel.avatarUrl ?? undefined} alt="" />
        <AvatarFallback>{fallback}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpen}
          className="block max-w-full truncate font-bold hover:text-primary hover:underline hover:underline-offset-4"
        >
          {name}
        </button>
        <p className="truncate text-xs text-muted-foreground">
          {channel.handle ? `${channel.handle} · ` : ''}
          {channel.platformName}
        </p>
      </div>
    </div>
  );
}

export function ChannelsSection({
  channels,
  metrics,
  onChannel,
  onCorrect,
  onAdd,
}: {
  channels: Channel[];
  metrics: Metrics;
  onChannel: (channel: Channel) => void;
  onCorrect: (channel: Channel) => void;
  onAdd: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-3xl border border-border/80 bg-card">
      <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-bold">Каналы</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatNumber(metrics.channelCount)} каналов ·{' '}
            {formatAvailable(metrics.totalViews, metrics.totalViewsCount)}{' '}
            охватов
          </p>
        </div>
        <Button size="sm" onClick={onAdd}>
          <Plus data-icon="inline-start" /> Добавить
        </Button>
      </div>
      {channels.length === 0 ? (
        <EmptyState
          title="Каналы не найдены"
          description="Измените фильтры или подключите первый канал по ссылке."
          action={<Button onClick={onAdd}>Добавить канал</Button>}
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1320px] text-sm">
              <thead className="border-y border-border bg-muted/45 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-semibold">Канал</th>
                  <th className="px-4 py-3 font-semibold">Креатор</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Подписчики
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">Охваты</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    30 дней
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Публикации
                  </th>
                  <th className="px-4 py-3 font-semibold">Синхронизация</th>
                  <th className="px-4 py-3 font-semibold">Свежесть</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-6 py-3">
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {channels.map((channel) => {
                  const channelMetrics = effectiveChannelMetrics(channel);
                  return (
                    <tr
                      key={channel.id}
                      className="border-b border-border/70 last:border-0 hover:bg-muted/35"
                    >
                      <td className="px-6 py-4">
                        <ChannelIdentity
                          channel={channel}
                          onOpen={() => onChannel(channel)}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold">{channel.creatorName}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <TypeBadge type={channel.creatorType} />
                          <span className="text-xs text-muted-foreground">
                            {channel.producerName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right font-semibold tabular-nums">
                        {formatChannelMetric(channelMetrics.followers)}
                      </td>
                      <td className="px-4 py-4 text-right font-bold tabular-nums">
                        {formatChannelMetric(channelMetrics.totalViews)}
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums">
                        {channelMetrics.reach30d === null
                          ? '—'
                          : formatNumber(channelMetrics.reach30d)}
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums">
                        {formatChannelMetric(channelMetrics.publicationCount)}
                      </td>
                      <td className="px-4 py-4">
                        <SyncStatusBadge status={channel.lastSyncStatus} />
                        {channel.lastSyncError && (
                          <p
                            className="mt-1 max-w-44 truncate text-[10px] text-destructive"
                            title={channel.lastSyncError}
                          >
                            {channel.lastSyncError}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <FreshnessBadge lastSyncAt={channel.lastSyncAt} />
                        <p
                          className="mt-1 text-[10px] text-muted-foreground"
                          title={formatDateTime(channel.lastSyncAt)}
                        >
                          {formatRelativeSync(channel.lastSyncAt)}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <RecordStatusBadge status={channel.status} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            render={
                              <a
                                href={channel.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Открыть канал ${channel.title || channel.platformName}`}
                              />
                            }
                            aria-label={`Открыть канал ${channel.title || channel.platformName}`}
                          >
                            <ExternalLink />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onCorrect(channel)}
                            aria-label={`Корректировка канала ${channel.title || channel.platformName}`}
                          >
                            <Pencil />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border lg:hidden">
            {channels.map((channel) => {
              const channelMetrics = effectiveChannelMetrics(channel);
              return (
                <article key={channel.id} className="min-w-0 px-5 py-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <ChannelIdentity
                        channel={channel}
                        onOpen={() => onChannel(channel)}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onCorrect(channel)}
                      aria-label={`Корректировка канала ${channel.title || channel.platformName}`}
                    >
                      <Pencil />
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChannel(channel)}
                    className="mt-3 block w-full text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <TypeBadge type={channel.creatorType} />
                      <span className="text-xs font-semibold">
                        {channel.creatorName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {channel.producerName}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 min-[420px]:grid-cols-4">
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          Подписчики
                        </p>
                        <p className="font-bold tabular-nums">
                          {formatChannelMetric(channelMetrics.followers)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          Охваты
                        </p>
                        <p className="font-bold tabular-nums">
                          {formatChannelMetric(channelMetrics.totalViews)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          30 дней
                        </p>
                        <p className="font-semibold tabular-nums">
                          {channelMetrics.reach30d === null
                            ? '—'
                            : formatNumber(channelMetrics.reach30d)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          Публикации
                        </p>
                        <p className="font-semibold tabular-nums">
                          {formatChannelMetric(channelMetrics.publicationCount)}
                        </p>
                      </div>
                    </div>
                  </button>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <SyncStatusBadge status={channel.lastSyncStatus} />
                    <FreshnessBadge lastSyncAt={channel.lastSyncAt} />
                    <RecordStatusBadge status={channel.status} />
                    <a
                      href={channel.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary"
                    >
                      Открыть <ExternalLink className="size-3" />
                    </a>
                  </div>
                  {channel.lastSyncError && (
                    <p className="mt-2 break-words text-xs text-destructive">
                      {channel.lastSyncError}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}

export function ProducersSection({
  producers,
  creators,
  rows,
  onProducer,
  onEdit,
}: {
  producers: Producer[];
  creators: Creator[];
  rows: SummaryRow[];
  onProducer: (id: number) => void;
  onEdit: (producer: Producer) => void;
}) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return (
    <article className="overflow-hidden rounded-3xl border border-border/80 bg-card">
      <div className="px-5 py-4 sm:px-6">
        <h2 className="font-bold">Продюсеры</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Закреплённые креаторы и агрегаты их каналов
        </p>
      </div>
      {producers.length === 0 ? (
        <EmptyState
          title="Продюсеры не найдены"
          description="Измените фильтры или обратитесь к администратору справочника."
        />
      ) : (
        <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-3 sm:p-5">
          {producers.map((producer) => {
            const row = byId.get(producer.id) ?? {
              id: producer.id,
              name: producer.name,
              creatorCount: 0,
              channelCount: 0,
              followers: 0,
              followersCount: 0,
              totalViews: 0,
              totalViewsCount: 0,
              publicationCount: 0,
              publicationCountCount: 0,
              reach30d: 0,
              reach30dCount: 0,
            };
            const directoryCreatorCount = creators.filter(
              (creator) => creator.producerId === producer.id,
            ).length;
            return (
              <article
                key={producer.id}
                className="rounded-2xl border border-border bg-background/60 p-5 hover:border-primary/25"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onProducer(producer.id)}
                    className="min-w-0 text-left"
                  >
                    <p className="truncate text-lg font-extrabold tracking-[-0.03em] hover:text-primary">
                      {producer.name}
                    </p>
                    <div className="mt-2">
                      <RecordStatusBadge status={producer.status} />
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onEdit(producer)}
                    aria-label={`Корректировать продюсера ${producer.name}`}
                  >
                    <Pencil />
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={() => onProducer(producer.id)}
                  aria-label={`Открыть показатели продюсера ${producer.name}`}
                  className="mt-6 block w-full text-left"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Закреплено
                      </p>
                      <p className="mt-1 text-xl font-extrabold tabular-nums">
                        {formatNumber(directoryCreatorCount)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        креаторов в справочнике
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Каналов</p>
                      <p className="mt-1 text-xl font-extrabold tabular-nums">
                        {formatNumber(row.channelCount)}
                      </p>
                    </div>
                    <div className="border-t border-border pt-4">
                      <p className="text-xs text-muted-foreground">
                        Подписчики
                      </p>
                      <p className="mt-1 text-lg font-extrabold tabular-nums">
                        {formatAvailable(row.followers, row.followersCount)}
                      </p>
                    </div>
                    <div className="border-t border-border pt-4">
                      <p className="text-xs text-muted-foreground">Охваты</p>
                      <p className="mt-1 text-lg font-extrabold tabular-nums">
                        {formatAvailable(row.totalViews, row.totalViewsCount)}
                      </p>
                    </div>
                    <div className="border-t border-border pt-4">
                      <p className="text-xs text-muted-foreground">
                        Публикации
                      </p>
                      <p className="mt-1 text-lg font-extrabold tabular-nums">
                        {formatAvailable(
                          row.publicationCount,
                          row.publicationCountCount,
                        )}
                      </p>
                    </div>
                    <div className="border-t border-border pt-4">
                      <p className="text-xs text-muted-foreground">
                        Охват 30 дней
                      </p>
                      <p className="mt-1 text-lg font-extrabold tabular-nums">
                        {formatAvailable(row.reach30d, row.reach30dCount)}
                      </p>
                    </div>
                  </div>
                </button>
              </article>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function CreatorSectionIcon({ type }: { type: CreatorType }) {
  return type === 'AI' ? (
    <Bot className="size-5" />
  ) : (
    <CircleUserRound className="size-5" />
  );
}
