'use client';

import { ChannelContacts } from '@/components/channel-contacts';
import { channelSyncHelp, channelCoverage } from '@/lib/channel-sync-help.mjs';
import { socialInstructions } from '@/lib/social-instructions.mjs';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';

import {
  FreshnessBadge,
  RecordStatusBadge,
  SyncStatusBadge,
  TypeBadge,
} from '@/components/content-sections';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
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
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  effectiveChannelMetrics,
  formatDateTime,
  formatNumber,
  makeMetrics,
} from '@/lib/content-metrics';
import type {
  Channel,
  Creator,
  DashboardData,
  Producer,
  SummaryRow,
} from '@/lib/content-types';

type Mutate = (payload: Record<string, unknown>) => Promise<void>;

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && (
          <span className="text-right text-[11px] text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function ChannelDialog({ open, onClose }: { open: boolean; onClose: () => void; data: DashboardData; mutate: Mutate }) {
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Добавить канал через Telegram</DialogTitle>
        <DialogDescription>Каналы добавляются из аккаунта креатора, чтобы сохранить его Telegram, продюсера и общий тип контента.</DialogDescription>
      </DialogHeader>
      <p className="text-sm leading-relaxed">Продюсер создаёт приглашение в боте. Креатор открывает его, один раз выбирает ИИ / UGC и отправляет ссылку на свой канал или видео. Показатели обновляются автоматически раз в сутки.</p>
      <a className="rounded-xl bg-primary px-4 py-3 text-center font-semibold text-primary-foreground" href="https://t.me/contentlsbot" target="_blank" rel="noopener noreferrer">Открыть @contentlsbot</a>
    </DialogContent>
  </Dialog>;
}

function overrideValue(value: number | null) {
  return value === null ? '' : String(value);
}

function nullableNumber(value: string) {
  return value.trim() === '' ? null : Number(value);
}

export function ChannelCorrectionDialog({
  open,
  onClose,
  channel,
  mutate,
}: {
  open: boolean;
  onClose: () => void;
  channel: Channel | null;
  mutate: Mutate;
}) {
  const [status, setStatus] = useState<Channel['status']>('active');
  const [url, setUrl] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editingId = useRef<number | null>(null);
  const [followers, setFollowers] = useState('');
  const [totalViews, setTotalViews] = useState('');
  const [publicationCount, setPublicationCount] = useState('');
  const [totalLikes, setTotalLikes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !channel) { editingId.current = null; return; }
    // Background metric refreshes must not reset an unsaved URL or confirmation.
    if (editingId.current === channel.id) return;
    editingId.current = channel.id;
    setStatus(channel.status);
    setUrl(channel.url);
    setConfirmDelete(false);
    setFollowers(overrideValue(channel.followersOverride));
    setTotalViews(overrideValue(channel.totalViewsOverride));
    setPublicationCount(overrideValue(channel.publicationCountOverride));
    setTotalLikes(overrideValue(channel.totalLikesOverride));
    setSaving(false);
    setError('');
  }, [channel, open]);

  function resetOverrides() {
    setFollowers('');
    setTotalViews('');
    setPublicationCount('');
    setTotalLikes('');
  }

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!channel) return;
    setSaving(true);
    setError('');
    try {
      await mutate({
        action: 'updateChannel',
        id: channel.id,
        url,
        status,
        followersOverride: nullableNumber(followers),
        totalViewsOverride: nullableNumber(totalViews),
        publicationCountOverride: nullableNumber(publicationCount),
        totalLikesOverride: nullableNumber(totalLikes),
      });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось сохранить корректировку',
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeChannel() {
    if (!channel) return;
    setSaving(true);
    setError('');
    try {
      await mutate({ action: 'deleteChannel', id: channel.id });
      setConfirmDelete(false);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить канал');
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[620px]">
        {channel && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-extrabold tracking-[-0.03em]">
                Редактирование канала
              </DialogTitle>
              <DialogDescription>
                {channel.title || channel.handle || channel.platformName}.
                Автоматические данные остаются источником истины; заполненные
                поля ниже временно их заменяют.
              </DialogDescription>
            </DialogHeader>
            <Alert className="border-primary/15 bg-primary/[0.035]">
              <Sparkles />
              <AlertTitle>Данные площадки</AlertTitle>
              <AlertDescription>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                  <span>
                    Подписчики
                    <br />
                    <strong className="text-foreground">
                      {channel.followers === null
                        ? '—'
                        : formatNumber(channel.followers)}
                    </strong>
                  </span>
                  <span>
                    Просмотры
                    <br />
                    <strong className="text-foreground">
                      {channel.totalViews === null
                        ? '—'
                        : formatNumber(channel.totalViews)}
                    </strong>
                  </span>
                  <span>
                    Ролики
                    <br />
                    <strong className="text-foreground">
                      {channel.publicationCount === null
                        ? '—'
                        : formatNumber(channel.publicationCount)}
                    </strong>
                  </span>
                  <span>
                    Лайки
                    <br />
                    <strong className="text-foreground">
                      {channel.totalLikes === null
                        ? '—'
                        : formatNumber(channel.totalLikes)}
                    </strong>
                  </span>
                </div>
              </AlertDescription>
            </Alert>
            <form onSubmit={submit} className="space-y-5">
              <FormField label="Ссылка на канал" htmlFor="edit-channel-url">
                <Input id="edit-channel-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} />
              </FormField>
              {url.trim() !== channel.url && <p className="text-sm text-muted-foreground">При замене адреса статистика нового канала будет собрана заново. Старые показатели и корректировки не переносятся.</p>}
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Значения-корректировки
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetOverrides}
                >
                  <RotateCcw data-icon="inline-start" /> Использовать данные
                  площадки
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Подписчики"
                  htmlFor="override-followers"
                  hint="пусто = авто"
                >
                  <Input
                    id="override-followers"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    placeholder="Автоматически"
                    value={followers}
                    onChange={(event) => setFollowers(event.target.value)}
                  />
                </FormField>
                <FormField
                  label="Просмотры"
                  htmlFor="override-views"
                  hint="пусто = авто"
                >
                  <Input
                    id="override-views"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    placeholder="Автоматически"
                    value={totalViews}
                    onChange={(event) => setTotalViews(event.target.value)}
                  />
                </FormField>
                <FormField
                  label="Ролики"
                  htmlFor="override-publications"
                  hint="пусто = авто"
                >
                  <Input
                    id="override-publications"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    placeholder="Автоматически"
                    value={publicationCount}
                    onChange={(event) =>
                      setPublicationCount(event.target.value)
                    }
                  />
                </FormField>
                <FormField
                  label="Лайки"
                  htmlFor="override-reach"
                  hint="пусто = авто"
                >
                  <Input
                    id="override-reach"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    placeholder="Автоматически"
                    value={totalLikes}
                    onChange={(event) => setTotalLikes(event.target.value)}
                  />
                </FormField>
              </div>
              <FormField label="Жизненный цикл" htmlFor="channel-status">
                <NativeSelect
                  id="channel-status"
                  className="w-full"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as Channel['status'])
                  }
                >
                  <NativeSelectOption value="active">
                    Активен · участвует в работе
                  </NativeSelectOption>
                  <NativeSelectOption value="inactive">
                    Неактивен
                  </NativeSelectOption>
                </NativeSelect>
              </FormField>
              {error && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Не удалось сохранить</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button type="button" variant="destructive" disabled={saving} onClick={() => setConfirmDelete(true)} className="sm:mr-auto">
                  <Trash2 /> Удалить канал
                </Button>
                <Button type="button" variant="outline" onClick={onClose}>
                  Отмена
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Сохраняем…' : 'Сохранить изменения'}
                </Button>
              </DialogFooter>
            </form>
            <AlertDialog open={confirmDelete} onOpenChange={(value) => !saving && setConfirmDelete(value)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Удалить канал?</AlertDialogTitle>
                  <AlertDialogDescription className="break-all">{channel.url}</AlertDialogDescription>
                </AlertDialogHeader>
                <p className="text-sm">Канал исчезнет из списков и выгрузок, сбор остановится. Креатор и остальные каналы сохранятся. Администратор сможет восстановить запись из архива.</p>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <AlertDialogFooter>
                  <Button variant="outline" disabled={saving} onClick={() => setConfirmDelete(false)}>Отмена</Button>
                  <Button variant="destructive" disabled={saving} onClick={removeChannel}>{saving ? 'Удаляем…' : 'Да, удалить'}</Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CreatorDialog({
  open,
  onClose,
  data,
  creator,
  mutate,
}: {
  open: boolean;
  onClose: () => void;
  data: DashboardData;
  creator: Creator | null;
  mutate: Mutate;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Creator['type']>('UGC');
  const [producerId, setProducerId] = useState('');
  const [status, setStatus] = useState<Creator['status']>('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open && creator) {
      setName(creator.name);
      setType(creator.type);
      setProducerId(String(creator.producerId));
      setStatus(creator.status);
      setError('');
      setSaving(false);
    }
  }, [creator, open]);
  const producers = data.producers.filter(
    (producer) =>
      producer.status === 'active' || producer.id === creator?.producerId,
  );
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creator) return;
    setSaving(true);
    setError('');
    try {
      await mutate({
        action: 'updateCreator',
        id: creator.id,
        name,
        type,
        producerId: Number(producerId),
        status,
      });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось сохранить креатора',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        {creator && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-extrabold">
                Корректировка профиля
              </DialogTitle>
              <DialogDescription>
                Метаданные креатора и его жизненный цикл. Метрики рассчитываются
                по каналам.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-5">
              <FormField label="Имя / название" htmlFor="creator-name">
                <Input
                  id="creator-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  minLength={2}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Тип" htmlFor="creator-type">
                  <NativeSelect
                    id="creator-type"
                    className="w-full"
                    value={type}
                    onChange={(event) =>
                      setType(event.target.value as Creator['type'])
                    }
                  >
                    <NativeSelectOption value="UGC">UGC</NativeSelectOption>
                    <NativeSelectOption value="AI">AI</NativeSelectOption>
                  </NativeSelect>
                </FormField>
                <FormField label="Статус" htmlFor="creator-status">
                  <NativeSelect
                    id="creator-status"
                    className="w-full"
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as Creator['status'])
                    }
                  >
                    <NativeSelectOption value="active">
                      Активен
                    </NativeSelectOption>
                    <NativeSelectOption value="inactive">
                      Неактивен
                    </NativeSelectOption>
                  </NativeSelect>
                </FormField>
              </div>
              <FormField
                label="Ответственный продюсер"
                htmlFor="creator-producer"
              >
                <NativeSelect
                  id="creator-producer"
                  className="w-full"
                  value={producerId}
                  onChange={(event) => setProducerId(event.target.value)}
                  required
                >
                  {producers.map((producer) => (
                    <NativeSelectOption key={producer.id} value={producer.id}>
                      {producer.name}
                      {producer.status === 'inactive' ? ' · неактивен' : ''}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              {error && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Не удалось сохранить</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  Отмена
                </Button>
                <Button type="submit" disabled={saving || !producers.length}>
                  {saving ? 'Сохраняем…' : 'Сохранить корректировку'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ProducerDialog({
  open,
  onClose,
  producer,
  mutate,
}: {
  open: boolean;
  onClose: () => void;
  producer: Producer | null;
  mutate: Mutate;
}) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Producer['status']>('active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open && producer) {
      setName(producer.name);
      setStatus(producer.status);
      setSaving(false);
      setError('');
    }
  }, [open, producer]);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!producer) return;
    setSaving(true);
    setError('');
    try {
      await mutate({ action: 'updateProducer', id: producer.id, name, status });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось сохранить продюсера',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        {producer && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-extrabold">
                Корректировка продюсера
              </DialogTitle>
              <DialogDescription>
                Измените данные справочника или жизненный цикл.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-5">
              <FormField label="Имя" htmlFor="producer-name">
                <Input
                  id="producer-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  minLength={2}
                />
              </FormField>
              <FormField label="Статус" htmlFor="producer-status">
                <NativeSelect
                  id="producer-status"
                  className="w-full"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as Producer['status'])
                  }
                >
                  <NativeSelectOption value="active">
                    Активен
                  </NativeSelectOption>
                  <NativeSelectOption value="inactive">
                    Неактивен
                  </NativeSelectOption>
                </NativeSelect>
              </FormField>
              {error && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Не удалось сохранить</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  Отмена
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Сохраняем…' : 'Сохранить корректировку'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="min-w-0 rounded-2xl bg-muted/60 p-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className="mt-1 truncate text-lg font-extrabold tabular-nums"
        title={String(value)}
      >
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
    </div>
  );
}

export function ChannelDetailDialog({
  channel,
  onClose,
  onCorrect,
}: {
  channel: Channel | null;
  onClose: () => void;
  onCorrect: (channel: Channel) => void;
}) {
  const metrics = channel ? effectiveChannelMetrics(channel) : null;
  return (
    <Dialog open={Boolean(channel)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[720px]">
        {channel && metrics && (
          <>
            <DialogHeader>
              <div className="flex flex-col items-start gap-4 pr-8 sm:flex-row sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge>{channel.platformName}</Badge>
                    <TypeBadge type={channel.creatorType} />
                    <RecordStatusBadge status={channel.status} />
                  </div>
                  <DialogTitle className="truncate text-2xl font-extrabold tracking-[-0.04em]">
                    {channel.title || channel.handle || channel.platformName}
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    {channel.creatorName} · {channel.producerName}
                  </DialogDescription>
                  <ChannelContacts channel={channel} />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCorrect(channel)}
                >
                  <Pencil data-icon="inline-start" /> Редактировать
                </Button>
              </div>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <SyncStatusBadge status={channel.lastSyncStatus} />
              <FreshnessBadge lastSyncAt={channel.lastSyncAt} />
              <span className="text-xs text-muted-foreground">
                Последнее обновление: {formatDateTime(channel.lastSyncAt)}
              </span>
            </div>
            {channel.lastSyncError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{channel.lastSyncStatus === 'needs_auth' ? 'Статистика пока недоступна' : 'Ошибка синхронизации'}</AlertTitle>
                <AlertDescription className="break-words">
                  {channelSyncHelp(channel.platformName, channel.lastSyncStatus) ?? channel.lastSyncError}
                </AlertDescription>
              </Alert>
            )}
            {channelCoverage(channel.parserSource) && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{channelCoverage(channel.parserSource)}</p>}
            <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-medium">API-доступ и инструкция {channel.platformName}</summary>
              <p className="mt-2">{channel.connectionStatus === 'connected' ? `Доступ подключён: ${channel.connectionUsername}` : channel.connectionStatus === 'needs_auth' ? 'Требуется переподключение доступа' : 'Персональный доступ не подключён'}. Креатор подключает его в боте: /channels → свой канал → Подключить API.</p>
              <ol className="list-decimal pl-5 space-y-2 mt-3">{socialInstructions[channel.platformName as keyof typeof socialInstructions]?.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </details>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricTile label="Подписчики" value={metrics.followers ?? '—'} />
              <MetricTile
                label="Просмотры"
                value={metrics.totalViews ?? '—'}
              />
              <MetricTile
                label="Ролики"
                value={metrics.publicationCount ?? '—'}
              />
              <MetricTile
                label="Лайки"
                value={metrics.totalLikes ?? '—'}
              />
            </div>
            <div className="rounded-2xl border border-border p-4">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Профиль</dt>
                  <dd className="mt-1 break-all font-semibold">
                    {channel.handle ||
                      channel.providerChannelId ||
                      'Определяется'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Источник</dt>
                  <dd className="mt-1 font-semibold">
                    {channel.parserSource || 'Автоматический парсер'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Следующая синхронизация
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {channel.nextSyncAt
                      ? formatDateTime(channel.nextSyncAt)
                      : 'По расписанию'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Ссылка</dt>
                  <dd className="mt-1">
                    <a
                      href={channel.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                    >
                      Открыть канал <ExternalLink className="size-3.5" />
                    </a>
                  </dd>
                </div>
              </dl>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CreatorDetailDialog({
  creator,
  channels,
  onClose,
  onEdit,
  onChannel,
  onCorrectChannel,
}: {
  creator: Creator | null;
  channels: Channel[];
  onClose: () => void;
  onEdit: (creator: Creator) => void;
  onChannel: (channel: Channel) => void;
  onCorrectChannel: (channel: Channel) => void;
}) {
  const creatorChannels = useMemo(
    () =>
      creator
        ? channels.filter((channel) => channel.creatorId === creator.id)
        : [],
    [channels, creator],
  );
  const metrics = makeMetrics(creatorChannels);
  return (
    <Dialog open={Boolean(creator)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[760px]">
        {creator && (
          <>
            <DialogHeader>
              <div className="flex flex-col items-start gap-4 pr-8 sm:flex-row sm:justify-between sm:gap-6">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <TypeBadge type={creator.type} />
                    <RecordStatusBadge status={creator.status} />
                  </div>
                  <DialogTitle className="text-2xl font-extrabold tracking-[-0.04em]">
                    {creator.name}
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    Ответственный продюсер: {creator.producerName}
                  </DialogDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(creator)}
                >
                  <Pencil data-icon="inline-start" /> Корректировка
                </Button>
              </div>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <MetricTile label="Каналы" value={metrics.channelCount} />
              <MetricTile
                label="Подписчики"
                value={metrics.followersCount ? metrics.followers : '—'}
              />
              <MetricTile
                label="Просмотры"
                value={metrics.totalViewsCount ? metrics.totalViews : '—'}
              />
              <MetricTile
                label="Ролики"
                value={
                  metrics.publicationCountCount ? metrics.publicationCount : '—'
                }
              />
              <MetricTile
                label="Лайки"
                value={metrics.totalLikesCount ? metrics.totalLikes : '—'}
              />
            </div>
            <div>
              <h3 className="mb-3 font-bold">Каналы</h3>
              {creatorChannels.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  В текущей выборке каналов нет.
                </p>
              ) : (
                <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                  {creatorChannels.map((channel) => {
                    const values = effectiveChannelMetrics(channel);
                    return (
                      <div
                        key={channel.id}
                        className="flex min-w-0 items-center justify-between gap-3 px-4 py-3"
                      >
                        <button
                          type="button"
                          onClick={() => onChannel(channel)}
                          className="min-w-0 text-left"
                        >
                          <p className="truncate text-sm font-bold hover:text-primary">
                            {channel.title ||
                              channel.handle ||
                              channel.platformName}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {channel.platformName} ·{' '}
                              {values.followers === null
                                ? '—'
                                : formatNumber(values.followers)}{' '}
                              подписчиков
                            </span>
                            <SyncStatusBadge status={channel.lastSyncStatus} />
                            <FreshnessBadge lastSyncAt={channel.lastSyncAt} />
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="hidden text-right sm:block">
                            <p className="text-sm font-bold tabular-nums">
                              {values.totalViews === null
                                ? '—'
                                : formatNumber(values.totalViews)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              охваты
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Корректировка канала ${channel.title || channel.platformName}`}
                            onClick={() => onCorrectChannel(channel)}
                          >
                            <Pencil />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ProducerDetailDialog({
  producer,
  creators,
  rows,
  channels,
  onClose,
  onEdit,
  onCreator,
}: {
  producer: Producer | null;
  creators: Creator[];
  rows: SummaryRow[];
  channels: Channel[];
  onClose: () => void;
  onEdit: (producer: Producer) => void;
  onCreator: (id: number) => void;
}) {
  const producerCreators = producer
    ? creators.filter((creator) => creator.producerId === producer.id)
    : [];
  const producerChannels = producer
    ? channels.filter((channel) => channel.producerId === producer.id)
    : [];
  const metrics = makeMetrics(producerChannels);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  return (
    <Dialog
      open={Boolean(producer)}
      onOpenChange={(next) => !next && onClose()}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[720px]">
        {producer && (
          <>
            <DialogHeader>
              <div className="flex flex-col items-start gap-4 pr-8 sm:flex-row sm:justify-between sm:gap-6">
                <div>
                  <div className="mb-2">
                    <RecordStatusBadge status={producer.status} />
                  </div>
                  <DialogTitle className="text-2xl font-extrabold tracking-[-0.04em]">
                    {producer.name}
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    Агрегаты каналов закреплённых креаторов
                  </DialogDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(producer)}
                >
                  <Pencil data-icon="inline-start" /> Корректировка
                </Button>
              </div>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MetricTile label="Закреплено" value={producerCreators.length} />
              <MetricTile label="Каналы" value={metrics.channelCount} />
              <MetricTile
                label="Подписчики"
                value={metrics.followersCount ? metrics.followers : '—'}
              />
              <MetricTile
                label="Просмотры"
                value={metrics.totalViewsCount ? metrics.totalViews : '—'}
              />
              <MetricTile
                label="Ролики"
                value={
                  metrics.publicationCountCount ? metrics.publicationCount : '—'
                }
              />
              <MetricTile
                label="Лайки"
                value={metrics.totalLikesCount ? metrics.totalLikes : '—'}
              />
            </div>
            <div>
              <h3 className="mb-3 font-bold">Креаторы</h3>
              {producerCreators.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Закреплённых креаторов пока нет.
                </p>
              ) : (
                <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                  {producerCreators.map((creator) => {
                    const row = rowById.get(creator.id);
                    return (
                      <button
                        key={creator.id}
                        type="button"
                        aria-label={`Открыть карточку креатора ${creator.name}`}
                        onClick={() => onCreator(creator.id)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            {creator.name}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <TypeBadge type={creator.type} />
                            <span className="text-xs text-muted-foreground">
                              {creator.status === 'active'
                                ? 'активен'
                                : 'неактивен'}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums">
                            {formatNumber(row?.totalViews ?? 0)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatNumber(row?.channelCount ?? 0)} каналов
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ExportDialog({
  open,
  onClose,
  onDownload,
}: {
  open: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="grid size-11 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <FileSpreadsheet className="size-5" />
          </div>
          <DialogTitle className="mt-2 text-xl font-extrabold">
            Отчёт готов
          </DialogTitle>
          <DialogDescription>
            Файл содержит каналы из текущей выборки и выбранный период. При выгрузке за даты добавлен лист с исходными снимками и полнотой данных. Его можно
            открыть или импортировать в Google Таблицы.
          </DialogDescription>
        </DialogHeader>
        <Alert className="border-primary/15 bg-primary/[0.035]">
          <Sparkles />
          <AlertTitle>Просмотры, ролики и лайки</AlertTitle>
          <AlertDescription>
            Общая статистика, каналы, UGC-креаторы и AI-креаторы — только нужные
            агрегаты.
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              window.open(
                'https://docs.google.com/spreadsheets/u/0/',
                '_blank',
                'noopener,noreferrer',
              )
            }
          >
            Открыть Google Таблицы <ExternalLink data-icon="inline-end" />
          </Button>
          <Button onClick={onDownload}>Скачать .xlsx</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
