'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  CircleUserRound,
  FileSpreadsheet,
  Filter,
  LayoutDashboard,
  Link2,
  Menu,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  UsersRound,
} from 'lucide-react';

import {
  ChannelCorrectionDialog,
  ChannelDetailDialog,
  ChannelDialog,
  CreatorDetailDialog,
  CreatorDialog,
  ExportDialog,
  ProducerDetailDialog,
  ProducerDialog,
} from '@/components/content-dialogs';
import {
  ChannelsSection,
  CreatorTypeSection,
  DashboardSection,
  MetricCards,
  ProducersSection,
} from '@/components/content-sections';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { moscowToday, validateReportPeriod } from '@/lib/report-period';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  buildCreatorRows,
  buildProducerRows,
  getFreshness,
  makeMetrics,
} from '@/lib/content-metrics';
import type {
  Channel,
  ChannelSyncStatus,
  Creator,
  CreatorType,
  DashboardData,
  Producer,
  RecordStatus,
} from '@/lib/content-types';
import { downloadGoogleSheetsReport } from '@/lib/xlsx-export';
import { TelegramAccounts } from '@/components/telegram-accounts';
import { SocialConnections } from '@/components/social-connections';

type View = 'dashboard' | 'ugc' | 'ai' | 'channels' | 'producers' | 'telegram' | 'social';
type FilterStatus = '' | RecordStatus | ChannelSyncStatus;
type Filters = {
  type: '' | CreatorType;
  producerId: string;
  creatorId: string;
  platformId: string;
  status: FilterStatus;
  dateFrom: string;
  dateTo: string;
};

const emptyData: DashboardData = {
  producers: [],
  creators: [],
  platforms: [],
  channels: [],
};

const navigation = [
  { id: 'dashboard' as const, label: 'Главная', icon: LayoutDashboard },
  { id: 'telegram' as const, label: 'Все TG-пользователи', icon: UsersRound },
  { id: 'social' as const, label: 'Доступы соцсетей', icon: Link2 },
  { id: 'ugc' as const, label: 'UGC-креаторы', icon: CircleUserRound },
  { id: 'ai' as const, label: 'AI-креаторы', icon: Bot },
  { id: 'channels' as const, label: 'Каналы', icon: Link2 },
  { id: 'producers' as const, label: 'Продюсеры', icon: UsersRound },
];

const viewCopy: Record<View, { title: string; description: string }> = {
  telegram: { title: 'Пользователи Telegram', description: 'Все регистрации из бота в единой админке. Автообновление — каждые 3 секунды.' },
  social: { title: 'Доступы соцсетей', description: 'Инструкции площадок, доступы владельцев и ограничения данных.' },
  dashboard: {
    title: 'Обзор',
    description: 'Аудитория, охваты и состояние всех подключённых каналов.',
  },
  ugc: {
    title: 'UGC-креаторы',
    description: 'Каналы и агрегированные показатели UGC-креаторов.',
  },
  ai: {
    title: 'AI-креаторы',
    description: 'Каналы и агрегированные показатели AI-креаторов.',
  },
  channels: {
    title: 'Каналы',
    description:
      'Единый реестр источников, автосинхронизация и свежесть данных.',
  },
  producers: {
    title: 'Продюсеры',
    description: 'Ответственные и результат каналов закреплённых креаторов.',
  },
};

function defaultFilters(): Filters {
  return {
    type: '',
    producerId: '',
    creatorId: '',
    platformId: '',
    status: 'active',
    dateFrom: '',
    dateTo: '',
  };
}

export default function ContentFactoryApp() {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [view, setView] = useState<View>('dashboard');
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [toast, setToast] = useState('');

  const [channelOpen, setChannelOpen] = useState(false);
  const [correctingChannelId, setCorrectingChannelId] = useState<number | null>(
    null,
  );
  const [editingCreator, setEditingCreator] = useState<Creator | null>(null);
  const [editingProducer, setEditingProducer] = useState<Producer | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(
    null,
  );
  const [selectedCreatorId, setSelectedCreatorId] = useState<number | null>(
    null,
  );
  const [selectedProducerId, setSelectedProducerId] = useState<number | null>(
    null,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const hasLoadedDataRef = useRef(false);
  const lastLoadSucceededRef = useRef(false);
  const actionsDisabled = loading || Boolean(error);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3600);
  }, []);

  const loadData = useCallback(async function refresh(
    showLoader = true,
    refreshAfterCurrent = false,
  ) {
    const activeRequest = loadInFlightRef.current;
    if (activeRequest) {
      await activeRequest;
      if (refreshAfterCurrent) await refresh(showLoader, false);
      return;
    }

    if (showLoader) {
      setLoading(true);
      setError('');
    }
    const request = (async () => {
      try {
        const response = await fetch('/api/data', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        const payload = (await response.json()) as DashboardData & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(payload.error || 'Не удалось загрузить данные');
        setData({ ...payload, channels: payload.channels ?? [] });
        hasLoadedDataRef.current = true;
        setError('');
        setRefreshError('');
        lastLoadSucceededRef.current = true;
      } catch (caught) {
        lastLoadSucceededRef.current = false;
        setRefreshError('Автообновление временно недоступно. Показываем последние загруженные данные; повторим автоматически.');
        if (showLoader || !hasLoadedDataRef.current) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Не удалось загрузить данные',
          );
        }
      } finally {
        if (showLoader) setLoading(false);
      }
    })();

    loadInFlightRef.current = request;
    try {
      await request;
    } finally {
      if (loadInFlightRef.current === request) loadInFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    void loadData();
    const refresh = () => void loadData(false);
    const intervalId = window.setInterval(refresh, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadData]);

  useEffect(() => {
    let revision = '';
    let busy = false;
    let stopped = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const response = await fetch('/api/revision', { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
        if (!response.ok) throw new Error();
        const payload = await response.json() as { revision: string };
        if (!stopped && revision !== payload.revision) {
          await loadData(false, true);
          if (lastLoadSucceededRef.current) revision = payload.revision;
        }
      } catch { if (!stopped) setRefreshError('Нет связи с сервером автообновления. Повторим автоматически.'); }
      finally { busy = false; }
    };
    const timer = window.setInterval(() => void check(), 3_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [loadData]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || 'Не удалось сохранить изменения');
      await loadData(false, true);
      const labels: Record<string, string> = {
        createChannel: 'Канал подключён и поставлен на синхронизацию',
        updateChannel: 'Корректировка канала сохранена',
        updateCreator: 'Профиль креатора обновлён',
        updateProducer: 'Карточка продюсера обновлена',
      };
      notify(labels[String(payload.action)] ?? 'Изменения сохранены');
    },
    [loadData, notify],
  );

  const forcedType: '' | CreatorType =
    view === 'ugc' ? 'UGC' : view === 'ai' ? 'AI' : '';

  const filteredChannels = useMemo(
    () =>
      data.channels.filter((channel) => {
        const selectedType = forcedType || filters.type;
        if (selectedType && channel.creatorType !== selectedType) return false;
        if (
          filters.producerId &&
          channel.producerId !== Number(filters.producerId)
        )
          return false;
        if (
          filters.creatorId &&
          channel.creatorId !== Number(filters.creatorId)
        )
          return false;
        if (
          filters.platformId &&
          channel.platformId !== Number(filters.platformId)
        )
          return false;
        if (filters.status === 'active' || filters.status === 'inactive')
          return channel.status === filters.status;
        if (filters.status && channel.lastSyncStatus !== filters.status)
          return false;
        return true;
      }),
    [data.channels, filters, forcedType],
  );

  const metrics = useMemo(
    () => makeMetrics(filteredChannels),
    [filteredChannels],
  );
  const ugcMetrics = useMemo(
    () =>
      makeMetrics(
        filteredChannels.filter((channel) => channel.creatorType === 'UGC'),
      ),
    [filteredChannels],
  );
  const aiMetrics = useMemo(
    () =>
      makeMetrics(
        filteredChannels.filter((channel) => channel.creatorType === 'AI'),
      ),
    [filteredChannels],
  );

  const matchingCreators = useMemo(
    () =>
      data.creators.filter((creator) => {
        const selectedType = forcedType || filters.type;
        if (selectedType && creator.type !== selectedType) return false;
        if (
          filters.producerId &&
          creator.producerId !== Number(filters.producerId)
        )
          return false;
        if (filters.creatorId && creator.id !== Number(filters.creatorId))
          return false;
        return true;
      }),
    [
      data.creators,
      filters.creatorId,
      filters.producerId,
      filters.type,
      forcedType,
    ],
  );

  const creatorRows = useMemo(
    () => buildCreatorRows(filteredChannels, matchingCreators, true),
    [filteredChannels, matchingCreators],
  );
  const allCreatorRows = useMemo(
    () => buildCreatorRows(filteredChannels, data.creators, true),
    [data.creators, filteredChannels],
  );
  const matchingProducers = useMemo(
    () =>
      data.producers.filter(
        (producer) =>
          !filters.producerId || producer.id === Number(filters.producerId),
      ),
    [data.producers, filters.producerId],
  );
  const producerRows = useMemo(
    () =>
      buildProducerRows(
        filteredChannels,
        matchingProducers,
        view === 'producers',
      ),
    [filteredChannels, matchingProducers, view],
  );

  const activeFilterCount = [
    filters.type,
    filters.producerId,
    filters.creatorId,
    filters.platformId,
    filters.status === 'active' ? '' : filters.status,
    filters.dateFrom || filters.dateTo,
  ].filter(Boolean).length;
  const selectedChannel =
    data.channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const correctingChannel =
    data.channels.find((channel) => channel.id === correctingChannelId) ?? null;
  const selectedCreator =
    data.creators.find((creator) => creator.id === selectedCreatorId) ?? null;
  const selectedProducer =
    data.producers.find((producer) => producer.id === selectedProducerId) ??
    null;
  const syncHealth = useMemo(
    () => ({
      fresh: filteredChannels.filter(
        (channel) => getFreshness(channel.lastSyncAt) === 'fresh',
      ).length,
      aging: filteredChannels.filter(
        (channel) => getFreshness(channel.lastSyncAt) === 'aging',
      ).length,
      stale: filteredChannels.filter(
        (channel) => getFreshness(channel.lastSyncAt) === 'stale',
      ).length,
      noData: filteredChannels.filter(
        (channel) => getFreshness(channel.lastSyncAt) === 'never',
      ).length,
      updating: filteredChannels.filter(
        (channel) =>
          channel.lastSyncStatus === 'pending' ||
          channel.lastSyncStatus === 'syncing',
      ).length,
      error: filteredChannels.filter(
        (channel) => channel.lastSyncStatus === 'error',
      ).length,
      needsAuth: filteredChannels.filter(
        (channel) => channel.lastSyncStatus === 'needs_auth',
      ).length,
    }),
    [filteredChannels],
  );

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === 'producerId' && current.creatorId) {
        const creator = data.creators.find(
          (item) => item.id === Number(current.creatorId),
        );
        if (value && creator?.producerId !== Number(value)) next.creatorId = '';
      }
      if (key === 'type' && current.creatorId) {
        const creator = data.creators.find(
          (item) => item.id === Number(current.creatorId),
        );
        if (value && creator?.type !== value) next.creatorId = '';
      }
      return next;
    });
  }

  function changeView(next: View) {
    setView(next);
    setMobileMenuOpen(false);
    if (next === 'ugc' || next === 'ai') {
      const nextType: CreatorType = next === 'ugc' ? 'UGC' : 'AI';
      setFilters((current) => {
        const creator = data.creators.find(
          (item) => item.id === Number(current.creatorId),
        );
        return {
          ...current,
          type: '',
          creatorId:
            creator && creator.type !== nextType ? '' : current.creatorId,
        };
      });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openAddChannel() {
    if (!actionsDisabled) setChannelOpen(true);
  }
  function openChannel(channel: Channel) {
    setSelectedCreatorId(null);
    setSelectedChannelId(channel.id);
  }
  function openCorrectChannel(channel: Channel) {
    setSelectedChannelId(null);
    setSelectedCreatorId(null);
    setCorrectingChannelId(channel.id);
  }
  function openEditCreator(creator: Creator) {
    setSelectedCreatorId(null);
    setEditingCreator(creator);
  }
  function openEditProducer(producer: Producer) {
    setSelectedProducerId(null);
    setEditingProducer(producer);
  }

  const exportData = useMemo(
    () => ({
      metrics,
      ugc: ugcMetrics,
      ai: aiMetrics,
      channels: filteredChannels,
      creatorRows: buildCreatorRows(filteredChannels, data.creators),
      producerRows: buildProducerRows(filteredChannels, data.producers),
    }),
    [
      aiMetrics,
      data.creators,
      data.producers,
      filteredChannels,
      metrics,
      ugcMetrics,
    ],
  );

  async function downloadReport() {
    if (exporting) return false;
    setExporting(true);
    setExportError('');
    try {
      let report = exportData;
      if (filters.dateFrom || filters.dateTo) {
        validateReportPeriod(filters.dateFrom, filters.dateTo);
        const query = new URLSearchParams({ from: filters.dateFrom, to: filters.dateTo });
        const response = await fetch(`/api/report?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
        const payload = await response.json() as DashboardData & { period: { from: string; to: string }; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Не удалось построить отчёт');
        const ids = new Set(filteredChannels.map((channel) => channel.id));
        const channels = payload.channels.filter((channel) => ids.has(channel.id));
        report = { ...payload, channels, metrics: makeMetrics(channels),
          ugc: makeMetrics(channels.filter((c) => c.creatorType === 'UGC')),
          ai: makeMetrics(channels.filter((c) => c.creatorType === 'AI')),
          creatorRows: buildCreatorRows(channels, payload.creators),
          producerRows: buildProducerRows(channels, payload.producers) };
      }
      downloadGoogleSheetsReport(report);
      notify('Отчёт скачан — его можно открыть в Google Таблицах');
      return true;
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : 'Не удалось скачать отчёт');
      return false;
    } finally { setExporting(false); }
  }
  async function beginExport() {
    if (!actionsDisabled && !exporting) {
      if (await downloadReport()) setExportOpen(true);
    }
  }

  const content = loading ? (
    <LoadingState />
  ) : error ? (
    <ErrorState message={error} onRetry={() => void loadData()} />
  ) : view === 'telegram' ? (
    <TelegramAccounts accounts={data.telegramAccounts ?? []} />
  ) : view === 'social' ? (
    <SocialConnections channels={data.channels} />
  ) : view === 'dashboard' ? (
    <DashboardSection
      metrics={metrics}
      ugc={ugcMetrics}
      ai={aiMetrics}
      creatorRows={creatorRows}
      producerRows={producerRows}
      typeFilter={filters.type}
      onViewType={(type) => changeView(type === 'UGC' ? 'ugc' : 'ai')}
      onCreator={setSelectedCreatorId}
      onProducer={setSelectedProducerId}
    />
  ) : view === 'ugc' || view === 'ai' ? (
    <CreatorTypeSection
      type={view === 'ugc' ? 'UGC' : 'AI'}
      metrics={metrics}
      rows={creatorRows}
      onCreator={setSelectedCreatorId}
    />
  ) : view === 'channels' ? (
    <ChannelsSection
      channels={filteredChannels}
      metrics={metrics}
      onChannel={openChannel}
      onCorrect={openCorrectChannel}
      onAdd={openAddChannel}
    />
  ) : (
    <div className="space-y-5">
      <MetricCards metrics={metrics} />
      <ProducersSection
        producers={matchingProducers}
        creators={data.creators}
        rows={producerRows}
        onProducer={setSelectedProducerId}
        onEdit={openEditProducer}
      />
    </div>
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/75 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1540px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Открыть меню"
            >
              <Menu />
            </Button>
            <Brand />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="hidden h-10 sm:inline-flex"
              onClick={beginExport}
              disabled={actionsDisabled || exporting}
            >
              <FileSpreadsheet data-icon="inline-start" /> Выгрузить в Google
              Таблицы {exporting ? '…' : ''}
            </Button>
            <Button
              className="h-10 px-3.5 shadow-sm"
              onClick={openAddChannel}
              disabled={actionsDisabled}
            >
              <Plus data-icon="inline-start" />
              <span className="hidden sm:inline">Добавить канал</span>
              <span className="sm:hidden">Канал</span>
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1540px] lg:grid-cols-[230px_minmax(0,1fr)]">
        <Sidebar view={view} onView={changeView} />
        <section className="min-w-0 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                {loading ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    Загружаем каналы…
                  </Badge>
                ) : error ? (
                  <Badge variant="destructive">Данные недоступны</Badge>
                ) : (
                  <>
                    <Badge
                      variant="outline"
                      className="border-primary/20 bg-primary/5 text-primary"
                    >
                      {metrics.channelCount
                        ? `${metrics.channelCount} каналов`
                        : 'Каналы не подключены'}
                    </Badge>
                    {syncHealth.fresh > 0 && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      >
                        {syncHealth.fresh} свежих
                      </Badge>
                    )}
                    {syncHealth.stale > 0 && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      >
                        {syncHealth.stale} устарели
                      </Badge>
                    )}
                    {syncHealth.aging > 0 && (
                      <Badge
                        variant="outline"
                        className="border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      >
                        {syncHealth.aging} обновлялись недавно
                      </Badge>
                    )}
                    {syncHealth.noData > 0 && syncHealth.updating === 0 && (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        {syncHealth.noData} без данных
                      </Badge>
                    )}
                    {syncHealth.updating > 0 && (
                      <Badge
                        variant="outline"
                        className="border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      >
                        {syncHealth.updating} обновляются
                      </Badge>
                    )}
                    {syncHealth.error > 0 && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      >
                        {syncHealth.error} с ошибкой
                      </Badge>
                    )}
                    {syncHealth.needsAuth > 0 && (
                      <Badge
                        variant="outline"
                        className="border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                      >
                        {syncHealth.needsAuth} нужен доступ
                      </Badge>
                    )}
                  </>
                )}
              </div>
              <h1 className="text-3xl font-extrabold tracking-[-0.045em] sm:text-[2.25rem]">
                {viewCopy[view].title}
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                {viewCopy[view].description}
              </p>
            </div>
            <Button
              variant="outline"
              className="self-start lg:hidden"
              onClick={() => setMobileFiltersOpen(true)}
              disabled={actionsDisabled}
            >
              <Filter data-icon="inline-start" /> Фильтры · {activeFilterCount}
            </Button>
          </div>
          {!loading && !error && !['telegram', 'social'].includes(view) && (
            <div className="mt-6 hidden lg:block">
              <FilterBar
                filters={filters}
                setFilter={setFilter}
                data={data}
                forcedType={forcedType}
                onReset={() => setFilters(defaultFilters())}
                resultCount={metrics.channelCount}
              />
            </div>
          )}
          {exportError && <Alert variant="destructive" className="mt-4"><AlertTitle>Выгрузка не создана</AlertTitle><AlertDescription>{exportError}</AlertDescription></Alert>}
          {refreshError && !loading && <output className="my-3 block text-sm text-amber-700">{refreshError}</output>}
          <div className="mt-6">{content}</div>
        </section>
      </div>
      <div className="fixed inset-x-4 bottom-4 z-20 grid grid-cols-[1fr_auto] gap-2 rounded-2xl border border-border bg-card/95 p-2 shadow-[0_18px_55px_rgba(35,31,55,.18)] backdrop-blur-xl sm:hidden">
        <Button
          variant="outline"
          onClick={beginExport}
          disabled={actionsDisabled}
        >
          <FileSpreadsheet data-icon="inline-start" /> Экспорт
        </Button>
        <Button onClick={openAddChannel} disabled={actionsDisabled}>
          <Plus data-icon="inline-start" /> Добавить канал
        </Button>
      </div>
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[310px]">
          <SheetHeader>
            <Brand />
            <SheetTitle className="sr-only">Навигация</SheetTitle>
            <SheetDescription className="sr-only">
              Разделы сервиса
            </SheetDescription>
          </SheetHeader>
          <nav className="space-y-1 px-3">
            {navigation.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => changeView(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${view === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <item.icon className="size-4" />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto border-t border-border p-4">
            <Button
              className="w-full justify-start"
              disabled={actionsDisabled}
              onClick={() => {
                setMobileMenuOpen(false);
                openAddChannel();
              }}
            >
              <Plus data-icon="inline-start" /> Добавить канал
            </Button>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Метрики обновляются автоматически по подключённым каналам.
            </p>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[90vh] overflow-y-auto rounded-t-3xl"
        >
          <SheetHeader>
            <SheetTitle>Фильтры каналов</SheetTitle>
            <SheetDescription>
              Все агрегаты пересчитаются одновременно.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <FilterFields
              filters={filters}
              setFilter={setFilter}
              data={data}
              forcedType={forcedType}
              idPrefix="mobile"
            />
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => setFilters(defaultFilters())}
              >
                <RotateCcw data-icon="inline-start" /> Сбросить
              </Button>
              <Button onClick={() => setMobileFiltersOpen(false)}>
                Показать · {metrics.channelCount}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ChannelDialog
        open={channelOpen}
        onClose={() => setChannelOpen(false)}
        data={data}
        mutate={mutate}
      />
      <ChannelCorrectionDialog
        open={Boolean(correctingChannel)}
        onClose={() => setCorrectingChannelId(null)}
        channel={correctingChannel}
        mutate={mutate}
      />
      <CreatorDialog
        open={Boolean(editingCreator)}
        onClose={() => setEditingCreator(null)}
        data={data}
        creator={editingCreator}
        mutate={mutate}
      />
      <ProducerDialog
        open={Boolean(editingProducer)}
        onClose={() => setEditingProducer(null)}
        producer={editingProducer}
        mutate={mutate}
      />
      <ChannelDetailDialog
        channel={selectedChannel}
        onClose={() => setSelectedChannelId(null)}
        onCorrect={openCorrectChannel}
      />
      <CreatorDetailDialog
        creator={selectedCreator}
        channels={filteredChannels}
        onClose={() => setSelectedCreatorId(null)}
        onEdit={openEditCreator}
        onChannel={openChannel}
        onCorrectChannel={openCorrectChannel}
      />
      <ProducerDetailDialog
        producer={selectedProducer}
        creators={data.creators}
        rows={allCreatorRows}
        channels={filteredChannels}
        onClose={() => setSelectedProducerId(null)}
        onEdit={openEditProducer}
        onCreator={(id) => {
          setSelectedProducerId(null);
          setSelectedCreatorId(id);
        }}
      />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onDownload={downloadReport}
      />
      {toast && (
        <output
          aria-live="polite"
          className="fixed bottom-24 right-4 z-[70] flex max-w-sm items-center gap-3 rounded-2xl bg-foreground px-4 py-3 text-sm font-semibold text-background shadow-2xl sm:bottom-6"
        >
          <CheckCircle2 className="size-4 text-[var(--accent-strong)]" />
          {toast}
        </output>
      )}
    </main>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_24px_-10px_var(--primary)]">
        <Sparkles className="size-4" />
      </div>
      <div>
        <p className="text-sm font-extrabold tracking-[-0.03em]">
          КОНТЕНТ-ЗАВОД
        </p>
        <p className="text-[11px] text-muted-foreground">Операционный центр</p>
      </div>
    </div>
  );
}

function Sidebar({
  view,
  onView,
}: {
  view: View;
  onView: (view: View) => void;
}) {
  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-64px)] border-r border-border/75 px-4 py-6 lg:flex lg:flex-col">
      <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        Рабочее пространство
      </p>
      <nav className="space-y-1">
        {navigation.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => onView(item.id)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors ${view === item.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <item.icon className="size-4" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="mt-auto rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="size-4 text-[var(--success)]" />
          <p className="text-xs font-bold">Автосинхронизация</p>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Аудитория, охваты и публикации загружаются напрямую с площадок.
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full rounded-full bg-[var(--success)]" />
        </div>
      </div>
    </aside>
  );
}

function FilterFields({
  filters,
  setFilter,
  data,
  forcedType,
  idPrefix,
}: {
  filters: Filters;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  data: DashboardData;
  forcedType: '' | CreatorType;
  idPrefix: 'desktop' | 'mobile';
}) {
  const selectedType = forcedType || filters.type;
  const creators = data.creators.filter(
    (creator) =>
      (!filters.producerId ||
        creator.producerId === Number(filters.producerId)) &&
      (!selectedType || creator.type === selectedType),
  );
  const id = (name: string) => `${idPrefix}-filter-${name}`;
  return (
    <div className="grid gap-4 lg:grid-cols-5 lg:items-end">
      <div className="space-y-2">
        <Label htmlFor={id('type')} className="text-xs text-muted-foreground">
          Тип
        </Label>
        <NativeSelect
          id={id('type')}
          className="w-full"
          value={forcedType || filters.type}
          disabled={Boolean(forcedType)}
          onChange={(event) =>
            setFilter('type', event.target.value as Filters['type'])
          }
        >
          <NativeSelectOption value="">Все</NativeSelectOption>
          <NativeSelectOption value="UGC">UGC</NativeSelectOption>
          <NativeSelectOption value="AI">AI</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label
          htmlFor={id('producer')}
          className="text-xs text-muted-foreground"
        >
          Продюсер
        </Label>
        <NativeSelect
          id={id('producer')}
          className="w-full"
          value={filters.producerId}
          onChange={(event) => setFilter('producerId', event.target.value)}
        >
          <NativeSelectOption value="">Все</NativeSelectOption>
          {data.producers.map((producer) => (
            <NativeSelectOption key={producer.id} value={producer.id}>
              {producer.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label
          htmlFor={id('creator')}
          className="text-xs text-muted-foreground"
        >
          Креатор
        </Label>
        <NativeSelect
          id={id('creator')}
          className="w-full"
          value={filters.creatorId}
          onChange={(event) => setFilter('creatorId', event.target.value)}
        >
          <NativeSelectOption value="">Все</NativeSelectOption>
          {creators.map((creator) => (
            <NativeSelectOption key={creator.id} value={creator.id}>
              {creator.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label
          htmlFor={id('platform')}
          className="text-xs text-muted-foreground"
        >
          Площадка
        </Label>
        <NativeSelect
          id={id('platform')}
          className="w-full"
          value={filters.platformId}
          onChange={(event) => setFilter('platformId', event.target.value)}
        >
          <NativeSelectOption value="">Все</NativeSelectOption>
          {data.platforms.map((platform) => (
            <NativeSelectOption key={platform.id} value={platform.id}>
              {platform.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-2">
        <Label htmlFor={id('status')} className="text-xs text-muted-foreground">
          Статус
        </Label>
        <NativeSelect
          id={id('status')}
          className="w-full"
          value={filters.status}
          onChange={(event) =>
            setFilter('status', event.target.value as FilterStatus)
          }
        >
          <NativeSelectOption value="">Все статусы</NativeSelectOption>
          <NativeSelectOption value="active">Активные</NativeSelectOption>
          <NativeSelectOption value="inactive">Неактивные</NativeSelectOption>
          <NativeSelectOption value="pending">В очереди</NativeSelectOption>
          <NativeSelectOption value="syncing">Обновляются</NativeSelectOption>
          <NativeSelectOption value="success">
            Синхронизированы
          </NativeSelectOption>
          <NativeSelectOption value="error">С ошибкой</NativeSelectOption>
          <NativeSelectOption value="needs_auth">
            Нужен доступ
          </NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="space-y-3 border-t border-border/70 pt-4 lg:col-span-5">
        <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 space-y-2 sm:w-48"><Label htmlFor={id('from')}>Период выгрузки — с</Label>
            <Input id={id('from')} type="date" value={filters.dateFrom} max={filters.dateTo || moscowToday()} onChange={(e) => setFilter('dateFrom', e.target.value)} /></div>
          <div className="min-w-0 space-y-2 sm:w-48"><Label htmlFor={id('to')}>По включительно</Label>
            <Input id={id('to')} type="date" value={filters.dateTo} min={filters.dateFrom || undefined} max={moscowToday()} onChange={(e) => setFilter('dateTo', e.target.value)} /></div>
          <Button variant="outline" type="button" onClick={() => { setFilter('dateFrom', moscowToday(new Date(Date.now() - 6 * 86400000))); setFilter('dateTo', moscowToday()); }}>7 дней</Button>
          <Button variant="ghost" type="button" onClick={() => { setFilter('dateFrom', ''); setFilter('dateTo', ''); }}>Текущие итоги</Button>
        </div>
        <p className="text-sm text-muted-foreground">Даты применяются к выгрузке: прирост просмотров, публикаций и лайков по ежедневным снимкам. Время — Москва. Карточки ниже показывают текущие итоги.</p>
      </div>
    </div>
  );
}

function FilterBar({
  filters,
  setFilter,
  data,
  forcedType,
  onReset,
  resultCount,
}: {
  filters: Filters;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  data: DashboardData;
  forcedType: '' | CreatorType;
  onReset: () => void;
  resultCount: number;
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-4">
      <FilterFields
        filters={filters}
        setFilter={setFilter}
        data={data}
        forcedType={forcedType}
        idPrefix="desktop"
      />
      <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3">
        <p className="text-xs text-muted-foreground">
          По выбранным фильтрам ·{' '}
          <strong className="text-foreground">{resultCount} каналов</strong>
        </p>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw data-icon="inline-start" /> Сбросить
        </Button>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-5" aria-label="Загрузка">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="h-36 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-64 animate-pulse rounded-3xl bg-muted" />
        <div className="h-64 animate-pulse rounded-3xl bg-muted" />
      </div>
      <div className="h-72 animate-pulse rounded-3xl bg-muted" />
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive" className="mx-auto max-w-xl p-5">
      <RefreshCw />
      <AlertTitle>Данные не загрузились</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" /> Попробовать снова
        </Button>
      </AlertDescription>
    </Alert>
  );
}
