'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  Pencil,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

import {
  FreshnessBadge,
  RecordStatusBadge,
  SyncStatusBadge,
  TypeBadge,
} from '@/components/content-sections';
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
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  detectPlatformId,
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

export function ChannelDialog({
  open,
  onClose,
  data,
  mutate,
}: {
  open: boolean;
  onClose: () => void;
  data: DashboardData;
  mutate: Mutate;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [creatorId, setCreatorId] = useState('');
  const [url, setUrl] = useState('');
  const [newCreatorName, setNewCreatorName] = useState('');
  const [newCreatorType, setNewCreatorType] = useState<Creator['type']>('UGC');
  const [newCreatorProducerId, setNewCreatorProducerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const activeCreators = useMemo(
    () => data.creators.filter((creator) => creator.status === 'active'),
    [data.creators],
  );
  const activeProducers = useMemo(
    () => data.producers.filter((producer) => producer.status === 'active'),
    [data.producers],
  );
  const detectedPlatformId = detectPlatformId(url, data.platforms);
  const detectedPlatform = data.platforms.find(
    (platform) => platform.id === detectedPlatformId,
  );

  useEffect(() => {
    if (!open) return;
    setMode(activeCreators.length ? 'existing' : 'new');
    setCreatorId(String(activeCreators[0]?.id ?? ''));
    setUrl('');
    setNewCreatorName('');
    setNewCreatorType('UGC');
    setNewCreatorProducerId(String(activeProducers[0]?.id ?? ''));
    setSaving(false);
    setError('');
  }, [activeCreators, activeProducers, open]);

  const canSubmit =
    Boolean(url.trim()) &&
    (mode === 'existing' ? Boolean(creatorId) : Boolean(newCreatorProducerId));

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await mutate(
        mode === 'existing'
          ? {
              action: 'createChannel',
              url: url.trim(),
              creatorId: Number(creatorId),
            }
          : {
              action: 'createChannel',
              url: url.trim(),
              newCreatorName: newCreatorName.trim() || undefined,
              newCreatorType,
              newCreatorProducerId: Number(newCreatorProducerId),
            },
      );
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось подключить канал',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[580px]">
        <DialogHeader>
          <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Link2 className="size-5" />
          </div>
          <DialogTitle className="mt-2 text-xl font-extrabold tracking-[-0.03em]">
            Добавить канал
          </DialogTitle>
          <DialogDescription>
            Вставьте ссылку на профиль или канал. Показатели публикаций и
            аудитории загрузятся автоматически.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <FormField
            label="Ссылка на канал"
            htmlFor="channel-url"
            hint="обязательное поле"
          >
            <Input
              id="channel-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
          </FormField>
          {url && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">
              {detectedPlatform ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  <span>
                    Площадка распознана:{' '}
                    <strong>{detectedPlatform.name}</strong>
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="size-4 text-primary" />
                  <span className="text-muted-foreground">
                    Площадка будет определена при подключении
                  </span>
                </>
              )}
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-bold text-muted-foreground">
              Привязать канал
            </p>
            <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
              <button
                type="button"
                aria-pressed={mode === 'existing'}
                disabled={!activeCreators.length}
                onClick={() => setMode('existing')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${mode === 'existing' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                К креатору
              </button>
              <button
                type="button"
                aria-pressed={mode === 'new'}
                disabled={!activeProducers.length}
                onClick={() => setMode('new')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${mode === 'new' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                Новый креатор
              </button>
            </div>
          </div>
          {mode === 'existing' ? (
            activeCreators.length ? (
              <FormField label="Креатор" htmlFor="channel-creator">
                <NativeSelect
                  id="channel-creator"
                  className="w-full"
                  value={creatorId}
                  onChange={(event) => setCreatorId(event.target.value)}
                  required
                >
                  {activeCreators.map((creator) => (
                    <NativeSelectOption key={creator.id} value={creator.id}>
                      {creator.name} · {creator.type} · {creator.producerName}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
            ) : (
              <Alert>
                <AlertCircle />
                <AlertTitle>Нет активных креаторов</AlertTitle>
                <AlertDescription>
                  Создайте креатора одновременно с каналом.
                </AlertDescription>
              </Alert>
            )
          ) : activeProducers.length ? (
            <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
              <FormField
                label="Имя / название"
                htmlFor="new-creator-name"
                hint="необязательно"
              >
                <Input
                  id="new-creator-name"
                  value={newCreatorName}
                  onChange={(event) => setNewCreatorName(event.target.value)}
                  placeholder="Если пусто — возьмём с площадки"
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Тип" htmlFor="new-creator-type">
                  <NativeSelect
                    id="new-creator-type"
                    className="w-full"
                    value={newCreatorType}
                    onChange={(event) =>
                      setNewCreatorType(event.target.value as Creator['type'])
                    }
                  >
                    <NativeSelectOption value="UGC">UGC</NativeSelectOption>
                    <NativeSelectOption value="AI">AI</NativeSelectOption>
                  </NativeSelect>
                </FormField>
                <FormField label="Продюсер" htmlFor="new-creator-producer">
                  <NativeSelect
                    id="new-creator-producer"
                    className="w-full"
                    value={newCreatorProducerId}
                    onChange={(event) =>
                      setNewCreatorProducerId(event.target.value)
                    }
                    required
                  >
                    {activeProducers.map((producer) => (
                      <NativeSelectOption key={producer.id} value={producer.id}>
                        {producer.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
            </div>
          ) : (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Нет активных продюсеров</AlertTitle>
              <AlertDescription>
                Новый креатор должен быть закреплён за продюсером. Активируйте
                продюсера или выберите существующего креатора.
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Не удалось подключить канал</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={saving || !canSubmit}>
              {saving ? 'Подключаем…' : 'Добавить канал'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
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
  const [followers, setFollowers] = useState('');
  const [totalViews, setTotalViews] = useState('');
  const [publicationCount, setPublicationCount] = useState('');
  const [reach30d, setReach30d] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !channel) return;
    setStatus(channel.status);
    setFollowers(overrideValue(channel.followersOverride));
    setTotalViews(overrideValue(channel.totalViewsOverride));
    setPublicationCount(overrideValue(channel.publicationCountOverride));
    setReach30d(overrideValue(channel.reach30dOverride));
    setSaving(false);
    setError('');
  }, [channel, open]);

  function resetOverrides() {
    setFollowers('');
    setTotalViews('');
    setPublicationCount('');
    setReach30d('');
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
        status,
        followersOverride: nullableNumber(followers),
        totalViewsOverride: nullableNumber(totalViews),
        publicationCountOverride: nullableNumber(publicationCount),
        reach30dOverride: nullableNumber(reach30d),
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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[620px]">
        {channel && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-extrabold tracking-[-0.03em]">
                Корректировка канала
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
                    Охваты
                    <br />
                    <strong className="text-foreground">
                      {channel.totalViews === null
                        ? '—'
                        : formatNumber(channel.totalViews)}
                    </strong>
                  </span>
                  <span>
                    Публикации
                    <br />
                    <strong className="text-foreground">
                      {channel.publicationCount === null
                        ? '—'
                        : formatNumber(channel.publicationCount)}
                    </strong>
                  </span>
                  <span>
                    30 дней
                    <br />
                    <strong className="text-foreground">
                      {channel.reach30d === null
                        ? '—'
                        : formatNumber(channel.reach30d)}
                    </strong>
                  </span>
                </div>
              </AlertDescription>
            </Alert>
            <form onSubmit={submit} className="space-y-5">
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
                  label="Охваты канала"
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
                  label="Публикации"
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
                  label="Охват за 30 дней"
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
                    value={reach30d}
                    onChange={(event) => setReach30d(event.target.value)}
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
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCorrect(channel)}
                >
                  <Pencil data-icon="inline-start" /> Корректировка
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
                <AlertTitle>Ошибка синхронизации</AlertTitle>
                <AlertDescription className="break-words">
                  {channel.lastSyncError}
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricTile label="Подписчики" value={metrics.followers ?? '—'} />
              <MetricTile
                label="Охваты канала"
                value={metrics.totalViews ?? '—'}
              />
              <MetricTile
                label="Публикации"
                value={metrics.publicationCount ?? '—'}
              />
              <MetricTile
                label="Охват за 30 дней"
                value={metrics.reach30d ?? '—'}
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
                label="Охваты"
                value={metrics.totalViewsCount ? metrics.totalViews : '—'}
              />
              <MetricTile
                label="Публикации"
                value={
                  metrics.publicationCountCount ? metrics.publicationCount : '—'
                }
              />
              <MetricTile
                label="30 дней"
                value={metrics.reach30dCount ? metrics.reach30d : '—'}
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
                label="Охваты"
                value={metrics.totalViewsCount ? metrics.totalViews : '—'}
              />
              <MetricTile
                label="Публикации"
                value={
                  metrics.publicationCountCount ? metrics.publicationCount : '—'
                }
              />
              <MetricTile
                label="30 дней"
                value={metrics.reach30dCount ? metrics.reach30d : '—'}
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
            Файл содержит 4 листа и только каналы из текущей выборки. Его можно
            открыть или импортировать в Google Таблицы.
          </DialogDescription>
        </DialogHeader>
        <Alert className="border-primary/15 bg-primary/[0.035]">
          <Sparkles />
          <AlertTitle>Канальная аналитика</AlertTitle>
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
