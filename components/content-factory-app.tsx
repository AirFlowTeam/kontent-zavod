'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  CircleUserRound,
  Clapperboard,
  FileSpreadsheet,
  Filter,
  LayoutDashboard,
  Menu,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  UserRoundPlus,
  UsersRound,
} from 'lucide-react';

import {
  CreatorDetailDialog,
  CreatorDialog,
  ExportDialog,
  ProducerDetailDialog,
  ProducerDialog,
  VideoDialog,
} from '@/components/content-dialogs';
import {
  CreatorTypeSection,
  DashboardSection,
  ProducersSection,
  VideosSection,
} from '@/components/content-sections';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  buildCreatorRows,
  buildProducerRows,
  currentMonthRange,
  makeMetrics,
  periodLabel,
} from '@/lib/content-metrics';
import type { Creator, CreatorType, DashboardData, Producer, Video } from '@/lib/content-types';
import { downloadGoogleSheetsReport } from '@/lib/xlsx-export';

type View = 'dashboard' | 'ugc' | 'ai' | 'videos' | 'producers';
type Filters = {
  from: string;
  to: string;
  type: '' | CreatorType;
  producerId: string;
  creatorId: string;
  platformId: string;
};

const emptyData: DashboardData = { producers: [], creators: [], platforms: [], videos: [] };

const navigation = [
  { id: 'dashboard' as const, label: 'Главная', icon: LayoutDashboard },
  { id: 'ugc' as const, label: 'UGC-креаторы', icon: CircleUserRound },
  { id: 'ai' as const, label: 'AI-креаторы', icon: Bot },
  { id: 'videos' as const, label: 'Все ролики', icon: Clapperboard },
  { id: 'producers' as const, label: 'Продюсеры', icon: UsersRound },
];

const viewCopy: Record<View, { title: string; description: string }> = {
  dashboard: { title: 'Обзор', description: 'Все публикации, охваты и вклад команды — в одном рабочем окне.' },
  ugc: { title: 'UGC-креаторы', description: 'Результаты людей, которые создают пользовательский контент.' },
  ai: { title: 'AI-креаторы', description: 'Публикации и охваты креаторов с AI-производством.' },
  videos: { title: 'Все ролики', description: 'Единый реестр публикаций, ссылок и текущих охватов.' },
  producers: { title: 'Продюсеры', description: 'Ответственные, их креаторы и суммарный результат.' },
};

function defaultFilters(): Filters {
  const range = currentMonthRange();
  return { from: range.from, to: range.to, type: '', producerId: '', creatorId: '', platformId: '' };
}

export default function ContentFactoryApp() {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('dashboard');
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [toast, setToast] = useState('');

  const [videoOpen, setVideoOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [editingCreator, setEditingCreator] = useState<Creator | null>(null);
  const [producerOpen, setProducerOpen] = useState(false);
  const [editingProducer, setEditingProducer] = useState<Producer | null>(null);
  const [selectedCreatorId, setSelectedCreatorId] = useState<number | null>(null);
  const [selectedProducerId, setSelectedProducerId] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3600);
  }, []);

  const loadData = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/data', { cache: 'no-store' });
      const payload = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить данные');
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить данные');
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const mutate = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить изменения');
    await loadData(false);
    const labels: Record<string, string> = {
      createVideo: 'Ролик добавлен, показатели пересчитаны', updateVideo: 'Ролик обновлён, показатели пересчитаны',
      createCreator: 'Креатор добавлен', updateCreator: 'Карточка креатора обновлена',
      createProducer: 'Продюсер добавлен', updateProducer: 'Карточка продюсера обновлена',
    };
    notify(labels[String(payload.action)] ?? 'Изменения сохранены');
  }, [loadData, notify]);

  const forcedType: '' | CreatorType = view === 'ugc' ? 'UGC' : view === 'ai' ? 'AI' : '';

  const filteredRecords = useMemo(() => data.videos.filter((video) => {
    const selectedType = forcedType || filters.type;
    if (filters.from && video.publishedAt < filters.from) return false;
    if (filters.to && video.publishedAt > filters.to) return false;
    if (selectedType && video.creatorType !== selectedType) return false;
    if (filters.producerId && video.producerId !== Number(filters.producerId)) return false;
    if (filters.creatorId && video.creatorId !== Number(filters.creatorId)) return false;
    if (filters.platformId && video.platformId !== Number(filters.platformId)) return false;
    return true;
  }), [data.videos, filters, forcedType]);

  const activeVideos = useMemo(() => filteredRecords.filter((video) => video.status === 'active'), [filteredRecords]);
  const metrics = useMemo(() => makeMetrics(activeVideos), [activeVideos]);
  const ugcMetrics = useMemo(() => makeMetrics(activeVideos.filter((video) => video.creatorType === 'UGC')), [activeVideos]);
  const aiMetrics = useMemo(() => makeMetrics(activeVideos.filter((video) => video.creatorType === 'AI')), [activeVideos]);

  const matchingCreators = useMemo(() => data.creators.filter((creator) => {
    const selectedType = forcedType || filters.type;
    if (selectedType && creator.type !== selectedType) return false;
    if (filters.producerId && creator.producerId !== Number(filters.producerId)) return false;
    if (filters.creatorId && creator.id !== Number(filters.creatorId)) return false;
    return true;
  }), [data.creators, filters.creatorId, filters.producerId, filters.type, forcedType]);

  const creatorRows = useMemo(() => buildCreatorRows(activeVideos, matchingCreators, view === 'ugc' || view === 'ai'), [activeVideos, matchingCreators, view]);
  const allCreatorRows = useMemo(() => buildCreatorRows(activeVideos, data.creators, true), [activeVideos, data.creators]);
  const matchingProducers = useMemo(() => data.producers.filter((producer) => !filters.producerId || producer.id === Number(filters.producerId)), [data.producers, filters.producerId]);
  const producerRows = useMemo(() => buildProducerRows(activeVideos, matchingProducers, view === 'producers'), [activeVideos, matchingProducers, view]);

  const activeFilterCount = [filters.type, filters.producerId, filters.creatorId, filters.platformId].filter(Boolean).length + (filters.from || filters.to ? 1 : 0);
  const selectedCreator = data.creators.find((creator) => creator.id === selectedCreatorId) ?? null;
  const selectedProducer = data.producers.find((producer) => producer.id === selectedProducerId) ?? null;

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === 'producerId' && current.creatorId) {
        const creator = data.creators.find((item) => item.id === Number(current.creatorId));
        if (value && creator?.producerId !== Number(value)) next.creatorId = '';
      }
      return next;
    });
  }

  function changeView(next: View) {
    setView(next);
    setMobileMenuOpen(false);
    if (next === 'ugc' || next === 'ai') setFilters((current) => ({ ...current, type: '' }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openAddVideo() { setEditingVideo(null); setVideoOpen(true); }
  function openEditVideo(video: Video) { setSelectedCreatorId(null); setEditingVideo(video); setVideoOpen(true); }
  function openAddCreator() { setEditingCreator(null); setCreatorOpen(true); }
  function openEditCreator(creator: Creator) { setSelectedCreatorId(null); setEditingCreator(creator); setCreatorOpen(true); }
  function openAddProducer() { setEditingProducer(null); setProducerOpen(true); }
  function openEditProducer(producer: Producer) { setSelectedProducerId(null); setEditingProducer(producer); setProducerOpen(true); }

  const exportData = useMemo(() => ({
    period: periodLabel(filters.from, filters.to), metrics, ugc: ugcMetrics, ai: aiMetrics,
    videos: filteredRecords, creatorRows: buildCreatorRows(activeVideos, data.creators), producerRows: buildProducerRows(activeVideos, data.producers),
  }), [activeVideos, aiMetrics, data.creators, data.producers, filteredRecords, filters.from, filters.to, metrics, ugcMetrics]);

  function downloadReport() { downloadGoogleSheetsReport(exportData); notify('Отчёт скачан — его можно импортировать в Google Таблицы'); }
  function beginExport() { downloadReport(); setExportOpen(true); }

  const content = loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => void loadData()} /> : view === 'dashboard' ? (
    <DashboardSection metrics={metrics} ugc={ugcMetrics} ai={aiMetrics} creatorRows={creatorRows} producerRows={producerRows} typeFilter={filters.type} onViewType={(type) => changeView(type === 'UGC' ? 'ugc' : 'ai')} onCreator={setSelectedCreatorId} onProducer={setSelectedProducerId} />
  ) : view === 'ugc' || view === 'ai' ? (
    <CreatorTypeSection type={view === 'ugc' ? 'UGC' : 'AI'} metrics={metrics} rows={creatorRows} onCreator={setSelectedCreatorId} />
  ) : view === 'videos' ? (
    <VideosSection videos={filteredRecords} activeMetrics={metrics} onEdit={openEditVideo} onAdd={openAddVideo} />
  ) : (
    <ProducersSection producers={matchingProducers} rows={producerRows} onProducer={setSelectedProducerId} onEdit={openEditProducer} onAdd={openAddProducer} />
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/75 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1540px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileMenuOpen(true)} aria-label="Открыть меню"><Menu /></Button>
            <Brand />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="hidden h-10 sm:inline-flex" onClick={beginExport} disabled={loading}><FileSpreadsheet data-icon="inline-start" /> Выгрузить в Google Таблицы</Button>
            <Button className="h-10 px-3.5 shadow-sm" onClick={openAddVideo} disabled={loading}><Plus data-icon="inline-start" /><span className="hidden sm:inline">Добавить ролик</span><span className="sm:hidden">Ролик</span></Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1540px] lg:grid-cols-[230px_minmax(0,1fr)]">
        <Sidebar view={view} onView={changeView} onAddCreator={openAddCreator} onAddProducer={openAddProducer} />
        <section className="min-w-0 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><Badge variant="outline" className="mb-3 border-primary/20 bg-primary/5 text-primary">{periodLabel(filters.from, filters.to)}</Badge><h1 className="text-3xl font-extrabold tracking-[-0.045em] sm:text-[2.25rem]">{viewCopy[view].title}</h1><p className="mt-2 max-w-xl text-sm text-muted-foreground">{viewCopy[view].description}</p></div>
            <Button variant="outline" className="self-start sm:hidden" onClick={() => setMobileFiltersOpen(true)}><Filter data-icon="inline-start" /> Фильтры · {activeFilterCount}</Button>
          </div>

          <div className="mt-6 hidden lg:block"><FilterBar filters={filters} setFilter={setFilter} data={data} forcedType={forcedType} onReset={() => setFilters(defaultFilters())} resultCount={metrics.videoCount} /></div>
          <div className="mt-6">{content}</div>
        </section>
      </div>

      <div className="fixed inset-x-4 bottom-4 z-20 grid grid-cols-[1fr_auto] gap-2 rounded-2xl border border-border bg-card/95 p-2 shadow-[0_18px_55px_rgba(35,31,55,.18)] backdrop-blur-xl sm:hidden"><Button variant="outline" onClick={beginExport} disabled={loading}><FileSpreadsheet data-icon="inline-start" /> Экспорт</Button><Button onClick={openAddVideo} disabled={loading}><Plus data-icon="inline-start" /> Добавить ролик</Button></div>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}><SheetContent side="left" className="w-[310px]"><SheetHeader><Brand /><SheetTitle className="sr-only">Навигация</SheetTitle><SheetDescription className="sr-only">Разделы сервиса</SheetDescription></SheetHeader><nav className="space-y-1 px-3">{navigation.map((item) => <button key={item.id} onClick={() => changeView(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${view === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><item.icon className="size-4" />{item.label}</button>)}</nav><div className="mt-auto space-y-2 border-t border-border p-4"><Button variant="outline" className="w-full justify-start" onClick={() => { setMobileMenuOpen(false); openAddCreator(); }}><UserRoundPlus data-icon="inline-start" /> Добавить креатора</Button><Button variant="outline" className="w-full justify-start" onClick={() => { setMobileMenuOpen(false); openAddProducer(); }}><UsersRound data-icon="inline-start" /> Добавить продюсера</Button></div></SheetContent></Sheet>
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}><SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-3xl"><SheetHeader><SheetTitle>Фильтры</SheetTitle><SheetDescription>Все показатели пересчитаются одновременно.</SheetDescription></SheetHeader><div className="px-4 pb-4"><FilterFields filters={filters} setFilter={setFilter} data={data} forcedType={forcedType} /><div className="mt-5 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setFilters(defaultFilters())}><RotateCcw data-icon="inline-start" /> Сбросить</Button><Button onClick={() => setMobileFiltersOpen(false)}>Показать · {metrics.videoCount}</Button></div></div></SheetContent></Sheet>

      <VideoDialog open={videoOpen} onClose={() => setVideoOpen(false)} data={data} video={editingVideo} mutate={mutate} />
      <CreatorDialog open={creatorOpen} onClose={() => setCreatorOpen(false)} data={data} creator={editingCreator} mutate={mutate} />
      <ProducerDialog open={producerOpen} onClose={() => setProducerOpen(false)} producer={editingProducer} mutate={mutate} />
      <CreatorDetailDialog creator={selectedCreator} videos={filteredRecords} onClose={() => setSelectedCreatorId(null)} onEdit={openEditCreator} onEditVideo={openEditVideo} />
      <ProducerDetailDialog producer={selectedProducer} creators={data.creators} rows={allCreatorRows} videos={filteredRecords} onClose={() => setSelectedProducerId(null)} onEdit={openEditProducer} onCreator={(id) => { setSelectedProducerId(null); setSelectedCreatorId(id); }} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} onDownload={downloadReport} />

      {toast && <output aria-live="polite" className="fixed bottom-24 right-4 z-[70] flex max-w-sm items-center gap-3 rounded-2xl bg-foreground px-4 py-3 text-sm font-semibold text-background shadow-2xl sm:bottom-6"><CheckCircle2 className="size-4 text-[var(--accent-strong)]" />{toast}</output>}
    </main>
  );
}

function Brand() {
  return <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_24px_-10px_var(--primary)]"><Sparkles className="size-4" /></div><div><p className="text-sm font-extrabold tracking-[-0.03em]">КОНТЕНТ-ЗАВОД</p><p className="text-[11px] text-muted-foreground">Операционный центр</p></div></div>;
}

function Sidebar({ view, onView, onAddCreator, onAddProducer }: { view: View; onView: (view: View) => void; onAddCreator: () => void; onAddProducer: () => void }) {
  return <aside className="sticky top-16 hidden h-[calc(100vh-64px)] border-r border-border/75 px-4 py-6 lg:flex lg:flex-col"><p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Рабочее пространство</p><nav className="space-y-1">{navigation.map((item) => <button key={item.id} onClick={() => onView(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors ${view === item.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><item.icon className="size-4" />{item.label}</button>)}</nav><div className="mt-auto space-y-2"><p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Справочники</p><button onClick={onAddCreator} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"><UserRoundPlus className="size-4" />Добавить креатора</button><button onClick={onAddProducer} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"><UsersRound className="size-4" />Добавить продюсера</button><div className="mt-3 rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold">Расчёты автоматические</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Новый ролик сразу обновляет все итоги.</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-full rounded-full bg-[var(--success)]" /></div></div></div></aside>;
}

function FilterFields({ filters, setFilter, data, forcedType }: { filters: Filters; setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void; data: DashboardData; forcedType: '' | CreatorType }) {
  const creators = data.creators.filter((creator) => !filters.producerId || creator.producerId === Number(filters.producerId));
  return <div className="grid gap-4 lg:grid-cols-[1fr_1fr_.8fr_1fr_1fr_1fr] lg:items-end"><div className="space-y-2"><Label htmlFor="filter-from" className="text-xs text-muted-foreground">Период с</Label><Input id="filter-from" type="date" value={filters.from} onChange={(event) => setFilter('from', event.target.value)} /></div><div className="space-y-2"><Label htmlFor="filter-to" className="text-xs text-muted-foreground">по</Label><Input id="filter-to" type="date" value={filters.to} onChange={(event) => setFilter('to', event.target.value)} /></div><div className="space-y-2"><Label htmlFor="filter-type" className="text-xs text-muted-foreground">Тип</Label><NativeSelect id="filter-type" className="w-full" value={forcedType || filters.type} disabled={Boolean(forcedType)} onChange={(event) => setFilter('type', event.target.value as Filters['type'])}><NativeSelectOption value="">Все</NativeSelectOption><NativeSelectOption value="UGC">UGC</NativeSelectOption><NativeSelectOption value="AI">AI</NativeSelectOption></NativeSelect></div><div className="space-y-2"><Label htmlFor="filter-producer" className="text-xs text-muted-foreground">Продюсер</Label><NativeSelect id="filter-producer" className="w-full" value={filters.producerId} onChange={(event) => setFilter('producerId', event.target.value)}><NativeSelectOption value="">Все</NativeSelectOption>{data.producers.map((producer) => <NativeSelectOption key={producer.id} value={producer.id}>{producer.name}</NativeSelectOption>)}</NativeSelect></div><div className="space-y-2"><Label htmlFor="filter-creator" className="text-xs text-muted-foreground">Креатор</Label><NativeSelect id="filter-creator" className="w-full" value={filters.creatorId} onChange={(event) => setFilter('creatorId', event.target.value)}><NativeSelectOption value="">Все</NativeSelectOption>{creators.map((creator) => <NativeSelectOption key={creator.id} value={creator.id}>{creator.name}</NativeSelectOption>)}</NativeSelect></div><div className="space-y-2"><Label htmlFor="filter-platform" className="text-xs text-muted-foreground">Площадка</Label><NativeSelect id="filter-platform" className="w-full" value={filters.platformId} onChange={(event) => setFilter('platformId', event.target.value)}><NativeSelectOption value="">Все</NativeSelectOption>{data.platforms.map((platform) => <NativeSelectOption key={platform.id} value={platform.id}>{platform.name}</NativeSelectOption>)}</NativeSelect></div></div>;
}

function FilterBar({ filters, setFilter, data, forcedType, onReset, resultCount }: { filters: Filters; setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void; data: DashboardData; forcedType: '' | CreatorType; onReset: () => void; resultCount: number }) {
  return <div className="rounded-2xl border border-border/80 bg-card p-4"><FilterFields filters={filters} setFilter={setFilter} data={data} forcedType={forcedType} /><div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3"><p className="text-xs text-muted-foreground">По выбранным фильтрам · <strong className="text-foreground">{resultCount} роликов</strong></p><Button variant="ghost" size="sm" onClick={onReset}><RotateCcw data-icon="inline-start" /> Сбросить</Button></div></div>;
}

function LoadingState() {
  return <div className="space-y-5" aria-label="Загрузка"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl bg-muted" />)}</div><div className="grid gap-4 xl:grid-cols-2"><div className="h-64 animate-pulse rounded-3xl bg-muted" /><div className="h-64 animate-pulse rounded-3xl bg-muted" /></div><div className="h-72 animate-pulse rounded-3xl bg-muted" /></div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Alert variant="destructive" className="mx-auto max-w-xl p-5"><RefreshCw /><AlertTitle>Данные не загрузились</AlertTitle><AlertDescription><p>{message}</p><Button variant="outline" size="sm" className="mt-4" onClick={onRetry}><RefreshCw data-icon="inline-start" /> Попробовать снова</Button></AlertDescription></Alert>;
}
