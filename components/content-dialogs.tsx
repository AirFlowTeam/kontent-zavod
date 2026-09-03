'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  Sparkles,
  UserRound,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { detectPlatformId, formatDate, formatNumber, isoToday, makeMetrics } from '@/lib/content-metrics';
import type { Creator, DashboardData, Producer, SummaryRow, Video } from '@/lib/content-types';

type Mutate = (payload: Record<string, unknown>) => Promise<void>;

function FormField({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><div className="flex items-baseline justify-between gap-3"><Label htmlFor={htmlFor}>{label}</Label>{hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}</div>{children}</div>;
}

export function VideoDialog({ open, onClose, data, video, mutate }: { open: boolean; onClose: () => void; data: DashboardData; video: Video | null; mutate: Mutate }) {
  const [creatorId, setCreatorId] = useState('');
  const [url, setUrl] = useState('');
  const [platformId, setPlatformId] = useState('');
  const [publishedAt, setPublishedAt] = useState(isoToday());
  const [reach, setReach] = useState('');
  const [status, setStatus] = useState<Video['status']>('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [autoDetected, setAutoDetected] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCreatorId(video ? String(video.creatorId) : String(data.creators.find((creator) => creator.status === 'active')?.id ?? ''));
    setUrl(video?.url ?? '');
    setPlatformId(video ? String(video.platformId) : '');
    setPublishedAt(video?.publishedAt ?? isoToday());
    setReach(video ? String(video.reach) : '');
    setStatus(video?.status ?? 'active');
    setSaving(false);
    setError('');
    setAutoDetected(false);
  }, [open, video, data.creators]);

  const creator = data.creators.find((item) => item.id === Number(creatorId));
  const availableCreators = data.creators.filter((item) => item.status === 'active' || item.id === video?.creatorId);
  const availablePlatforms = data.platforms.filter((item) => item.status === 'active' || item.id === video?.platformId);

  function updateUrl(value: string) {
    setUrl(value);
    const detected = detectPlatformId(value, data.platforms);
    if (detected) {
      setPlatformId(String(detected));
      setAutoDetected(true);
    } else {
      setAutoDetected(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await mutate({
        action: video ? 'updateVideo' : 'createVideo',
        id: video?.id,
        creatorId: Number(creatorId),
        platformId: Number(platformId),
        url,
        publishedAt,
        reach: Number(reach),
        status,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить ролик');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold tracking-[-0.03em]">{video ? 'Редактировать ролик' : 'Добавить ролик'}</DialogTitle>
          <DialogDescription>Одна уникальная ссылка считается одной публикацией.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          {availableCreators.length === 0 ? <Alert><AlertCircle /><AlertTitle>Сначала добавьте креатора</AlertTitle><AlertDescription>Для публикации нужен активный креатор и закреплённый продюсер.</AlertDescription></Alert> : <>
            <FormField label="Креатор" htmlFor="video-creator"><NativeSelect id="video-creator" className="w-full" value={creatorId} onChange={(event) => setCreatorId(event.target.value)} required>{availableCreators.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></FormField>
            {creator && <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-muted/45 p-4"><div><p className="text-[11px] text-muted-foreground">Тип · из карточки</p><Badge className={`mt-1.5 ${creator.type === 'AI' ? 'bg-[var(--ai-soft)] text-[var(--ai-ink)]' : 'bg-[var(--ugc-soft)] text-[var(--ugc-ink)]'}`}>{creator.type}</Badge></div><div><p className="text-[11px] text-muted-foreground">Продюсер · из карточки</p><p className="mt-1.5 text-sm font-bold">{creator.producerName}</p></div></div>}
            <FormField label="Ссылка на ролик" htmlFor="video-url"><Input id="video-url" type="url" placeholder="https://…" value={url} onChange={(event) => updateUrl(event.target.value)} required /></FormField>
            <FormField label="Площадка" htmlFor="video-platform" hint={autoDetected ? 'Определена автоматически' : 'Выберите вручную'}><NativeSelect id="video-platform" className="w-full" value={platformId} onChange={(event) => { setPlatformId(event.target.value); setAutoDetected(false); }} required><NativeSelectOption value="" disabled>Выберите площадку</NativeSelectOption>{availablePlatforms.map((platform) => <NativeSelectOption key={platform.id} value={platform.id}>{platform.name}</NativeSelectOption>)}</NativeSelect>{autoDetected && <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-3.5" /> Площадка распознана по ссылке</p>}</FormField>
            <div className="grid gap-4 sm:grid-cols-2"><FormField label="Дата публикации" htmlFor="video-date"><Input id="video-date" type="date" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} required /></FormField><FormField label="Охват" htmlFor="video-reach"><Input id="video-reach" type="number" inputMode="numeric" min="0" step="1" placeholder="25 000" value={reach} onChange={(event) => setReach(event.target.value)} required /></FormField></div>
            {video && <FormField label="Статус" htmlFor="video-status"><NativeSelect id="video-status" className="w-full" value={status} onChange={(event) => setStatus(event.target.value as Video['status'])}><NativeSelectOption value="active">Активен</NativeSelectOption><NativeSelectOption value="error">Ошибка</NativeSelectOption><NativeSelectOption value="deleted">Удалён</NativeSelectOption></NativeSelect></FormField>}
          </>}
          {error && <Alert variant="destructive"><AlertCircle /><AlertTitle>Не удалось сохранить</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter className="sticky -bottom-4">
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={saving || availableCreators.length === 0}>{saving ? 'Сохраняем…' : video ? 'Сохранить' : 'Добавить ролик'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreatorDialog({ open, onClose, data, creator, mutate }: { open: boolean; onClose: () => void; data: DashboardData; creator: Creator | null; mutate: Mutate }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Creator['type']>('UGC');
  const [producerId, setProducerId] = useState('');
  const [status, setStatus] = useState<Creator['status']>('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(creator?.name ?? ''); setType(creator?.type ?? 'UGC'); setProducerId(String(creator?.producerId ?? data.producers.find((producer) => producer.status === 'active')?.id ?? '')); setStatus(creator?.status ?? 'active'); setError(''); setSaving(false);
  }, [open, creator, data.producers]);

  const producers = data.producers.filter((producer) => producer.status === 'active' || producer.id === creator?.producerId);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await mutate({ action: creator ? 'updateCreator' : 'createCreator', id: creator?.id, name, type, producerId: Number(producerId), status }); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить креатора'); }
    finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}><DialogContent className="sm:max-w-[500px]"><DialogHeader><DialogTitle className="text-xl font-extrabold">{creator ? 'Редактировать креатора' : 'Новый креатор'}</DialogTitle><DialogDescription>Показатели рассчитаются автоматически по публикациям.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5">
    {producers.length === 0 ? <Alert><AlertCircle /><AlertTitle>Нет активных продюсеров</AlertTitle><AlertDescription>Сначала добавьте продюсера.</AlertDescription></Alert> : <><FormField label="Имя / название" htmlFor="creator-name"><Input id="creator-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Иван" required minLength={2} /></FormField><div className="grid grid-cols-2 gap-4"><FormField label="Тип" htmlFor="creator-type"><NativeSelect id="creator-type" className="w-full" value={type} onChange={(event) => setType(event.target.value as Creator['type'])}><NativeSelectOption value="UGC">UGC</NativeSelectOption><NativeSelectOption value="AI">AI</NativeSelectOption></NativeSelect></FormField><FormField label="Статус" htmlFor="creator-status"><NativeSelect id="creator-status" className="w-full" value={status} onChange={(event) => setStatus(event.target.value as Creator['status'])}><NativeSelectOption value="active">Активен</NativeSelectOption><NativeSelectOption value="inactive">Неактивен</NativeSelectOption></NativeSelect></FormField></div><FormField label="Ответственный продюсер" htmlFor="creator-producer"><NativeSelect id="creator-producer" className="w-full" value={producerId} onChange={(event) => setProducerId(event.target.value)} required>{producers.map((producer) => <NativeSelectOption key={producer.id} value={producer.id}>{producer.name}{producer.status === 'inactive' ? ' · неактивен' : ''}</NativeSelectOption>)}</NativeSelect></FormField></>}
    {error && <Alert variant="destructive"><AlertCircle /><AlertTitle>Не удалось сохранить</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}<DialogFooter><Button type="button" variant="outline" onClick={onClose}>Отмена</Button><Button type="submit" disabled={saving || producers.length === 0}>{saving ? 'Сохраняем…' : 'Сохранить'}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

export function ProducerDialog({ open, onClose, producer, mutate }: { open: boolean; onClose: () => void; producer: Producer | null; mutate: Mutate }) {
  const [name, setName] = useState(''); const [status, setStatus] = useState<Producer['status']>('active'); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (open) { setName(producer?.name ?? ''); setStatus(producer?.status ?? 'active'); setSaving(false); setError(''); } }, [open, producer]);
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { await mutate({ action: producer ? 'updateProducer' : 'createProducer', id: producer?.id, name, status }); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить продюсера'); } finally { setSaving(false); } }
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}><DialogContent className="sm:max-w-[460px]"><DialogHeader><DialogTitle className="text-xl font-extrabold">{producer ? 'Редактировать продюсера' : 'Новый продюсер'}</DialogTitle><DialogDescription>Продюсер отвечает за закреплённых креаторов.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5"><FormField label="Имя" htmlFor="producer-name"><Input id="producer-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Анна" required minLength={2} /></FormField>{producer && <FormField label="Статус" htmlFor="producer-status"><NativeSelect id="producer-status" className="w-full" value={status} onChange={(event) => setStatus(event.target.value as Producer['status'])}><NativeSelectOption value="active">Активен</NativeSelectOption><NativeSelectOption value="inactive">Неактивен</NativeSelectOption></NativeSelect></FormField>}{error && <Alert variant="destructive"><AlertCircle /><AlertTitle>Не удалось сохранить</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}<DialogFooter><Button type="button" variant="outline" onClick={onClose}>Отмена</Button><Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function CreatorDetailDialog({ creator, videos, onClose, onEdit, onEditVideo }: { creator: Creator | null; videos: Video[]; onClose: () => void; onEdit: (creator: Creator) => void; onEditVideo: (video: Video) => void }) {
  const creatorVideos = useMemo(() => creator ? videos.filter((video) => video.creatorId === creator.id) : [], [creator, videos]);
  const metrics = makeMetrics(creatorVideos.filter((video) => video.status === 'active'));
  return <Dialog open={Boolean(creator)} onOpenChange={(next) => !next && onClose()}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[720px]">{creator && <><DialogHeader><div className="flex items-start justify-between gap-8 pr-8"><div><div className="mb-2 flex items-center gap-2"><Badge className={creator.type === 'AI' ? 'bg-[var(--ai-soft)] text-[var(--ai-ink)]' : 'bg-[var(--ugc-soft)] text-[var(--ugc-ink)]'}>{creator.type}</Badge><Badge variant="outline">{creator.status === 'active' ? 'Активен' : 'Неактивен'}</Badge></div><DialogTitle className="text-2xl font-extrabold tracking-[-0.04em]">{creator.name}</DialogTitle><DialogDescription className="mt-1">Ответственный продюсер: {creator.producerName}</DialogDescription></div><Button variant="outline" size="sm" onClick={() => onEdit(creator)}><Pencil data-icon="inline-start" /> Редактировать</Button></div></DialogHeader><div className="grid grid-cols-3 gap-2">{[['Роликов', metrics.videoCount], ['Общий охват', metrics.reach], ['Средний', metrics.videoCount ? metrics.average : '—']].map(([label, value]) => <div key={label} className="rounded-2xl bg-muted/60 p-4"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-lg font-extrabold tabular-nums">{typeof value === 'number' ? formatNumber(value) : value}</p></div>)}</div><div><h3 className="mb-3 font-bold">Публикации</h3>{creatorVideos.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Публикаций пока нет.</p> : <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">{creatorVideos.map((video) => <div key={video.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="text-sm font-bold">{video.platformName} · {formatDate(video.publishedAt)}</p><a href={video.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary">Открыть ролик <ExternalLink className="size-3" /></a></div><div className="flex items-center gap-3"><strong className="text-sm tabular-nums">{formatNumber(video.reach)}</strong><Button variant="ghost" size="icon-sm" onClick={() => onEditVideo(video)}><Pencil /></Button></div></div>)}</div>}</div></>}</DialogContent></Dialog>;
}

export function ProducerDetailDialog({ producer, creators, rows, videos, onClose, onEdit, onCreator }: { producer: Producer | null; creators: Creator[]; rows: SummaryRow[]; videos: Video[]; onClose: () => void; onEdit: (producer: Producer) => void; onCreator: (id: number) => void }) {
  const producerCreators = producer ? creators.filter((creator) => creator.producerId === producer.id) : [];
  const producerVideos = producer ? videos.filter((video) => video.producerId === producer.id && video.status === 'active') : [];
  const metrics = makeMetrics(producerVideos);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  return <Dialog open={Boolean(producer)} onOpenChange={(next) => !next && onClose()}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[680px]">{producer && <><DialogHeader><div className="flex items-start justify-between gap-8 pr-8"><div><Badge variant="outline" className="mb-2">{producer.status === 'active' ? 'Активен' : 'Неактивен'}</Badge><DialogTitle className="text-2xl font-extrabold tracking-[-0.04em]">{producer.name}</DialogTitle><DialogDescription className="mt-1">Результат закреплённых креаторов</DialogDescription></div><Button variant="outline" size="sm" onClick={() => onEdit(producer)}><Pencil data-icon="inline-start" /> Редактировать</Button></div></DialogHeader><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Креаторов', metrics.creatorCount], ['Роликов', metrics.videoCount], ['Общий охват', metrics.reach], ['Средний', metrics.videoCount ? metrics.average : '—']].map(([label, value]) => <div key={label} className="rounded-2xl bg-muted/60 p-4"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-lg font-extrabold tabular-nums">{typeof value === 'number' ? formatNumber(value) : value}</p></div>)}</div><div><h3 className="mb-3 font-bold">Креаторы</h3><div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">{producerCreators.map((creator) => { const row = rowById.get(creator.id); return <button key={creator.id} onClick={() => onCreator(creator.id)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/40"><div><p className="text-sm font-bold">{creator.name}</p><p className="text-xs text-muted-foreground">{creator.type} · {creator.status === 'active' ? 'активен' : 'неактивен'}</p></div><div className="text-right"><p className="text-sm font-bold tabular-nums">{formatNumber(row?.reach ?? 0)}</p><p className="text-[10px] text-muted-foreground">{formatNumber(row?.videoCount ?? 0)} роликов</p></div></button>; })}</div></div></>}</DialogContent></Dialog>;
}

export function ExportDialog({ open, onClose, onDownload }: { open: boolean; onClose: () => void; onDownload: () => void }) {
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}><DialogContent className="sm:max-w-[500px]"><DialogHeader><div className="grid size-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><FileSpreadsheet className="size-5" /></div><DialogTitle className="mt-2 text-xl font-extrabold">Отчёт готов</DialogTitle><DialogDescription>Файл содержит 4 листа и только данные из текущей выборки. Его можно открыть или импортировать в Google Таблицы.</DialogDescription></DialogHeader><Alert className="border-primary/15 bg-primary/[0.035]"><Sparkles /><AlertTitle>Структура из ТЗ сохранена</AlertTitle><AlertDescription>Общая статистика, все ролики, UGC-креаторы и AI-креаторы.</AlertDescription></Alert><DialogFooter><Button variant="outline" onClick={() => window.open('https://docs.google.com/spreadsheets/u/0/', '_blank', 'noopener,noreferrer')}>Открыть Google Таблицы <ExternalLink data-icon="inline-end" /></Button><Button onClick={onDownload}>Скачать .xlsx</Button></DialogFooter></DialogContent></Dialog>;
}
