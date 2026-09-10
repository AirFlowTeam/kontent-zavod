'use client';

import { strToU8, zipSync } from 'fflate';

import { effectiveChannelMetrics, getFreshness } from '@/lib/content-metrics';
import type {
  Channel,
  ChannelSyncStatus,
  Metrics,
  SummaryRow,
} from '@/lib/content-types';

type Cell = string | number;
type Sheet = { name: string; rows: Cell[][]; widths: number[] };

export interface ReportExportData {
  period?: { from: string; to: string };
  metrics: Metrics;
  ugc: Metrics;
  ai: Metrics;
  channels: Channel[];
  creatorRows: SummaryRow[];
  producerRows: SummaryRow[];
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index: number) {
  let output = '';
  let value = index + 1;
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function worksheetXml(sheet: Sheet) {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const rowIsHeader =
        rowIndex === 0 ||
        (sheet.name === 'Общая статистика' && row[0] === 'Продюсер');
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          const style = rowIsHeader ? 1 : typeof cell === 'number' ? 2 : 0;
          if (typeof cell === 'number')
            return `<c r="${ref}" s="${style}"><v>${cell}</v></c>`;
          return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${escapeXml(cell)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  const cols = sheet.widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join('');
  const lastColumn = columnName(
    Math.max(...sheet.rows.map((row) => row.length), 1) - 1,
  );
  const lastRow = sheet.rows.length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
      <cols>${cols}</cols><sheetData>${rows}</sheetData>
      <autoFilter ref="A1:${lastColumn}${lastRow}"/>
    </worksheet>`;
}

function createWorkbook(sheets: Sheet[]) {
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, value: string) => {
    files[path] = strToU8(value);
  };
  put(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
    </Types>`,
  );
  put(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`,
  );
  put(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
    </workbook>`,
  );
  put(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
      <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    </Relationships>`,
  );
  put(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts>
      <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5B3FD3"/><bgColor indexed="64"/></patternFill></fill></fills>
      <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`,
  );
  sheets.forEach((sheet, index) =>
    put(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)),
  );
  return zipSync(files, { level: 6 });
}

function creatorSheet(type: 'UGC' | 'AI', rows: SummaryRow[]) {
  const matching = rows.filter((row) => row.type === type);
  const totals = matching.reduce(
    (result, row) => ({
      channels: result.channels + row.channelCount,
      followers: result.followers + row.followers,
      followersCount: result.followersCount + row.followersCount,
      views: result.views + row.totalViews,
      viewsCount: result.viewsCount + row.totalViewsCount,
      totalLikes: result.totalLikes + row.totalLikes,
      totalLikesCount: result.totalLikesCount + row.totalLikesCount,
      publications: result.publications + row.publicationCount,
      publicationsCount: result.publicationsCount + row.publicationCountCount,
    }),
    {
      channels: 0,
      followers: 0,
      followersCount: 0,
      views: 0,
      viewsCount: 0,
      totalLikes: 0,
      totalLikesCount: 0,
      publications: 0,
      publicationsCount: 0,
    },
  );
  return {
    name: `${type}-креаторы`,
    widths: [26, 22, 12, 18, 20, 18, 16],
    rows: [
      [
        'Креатор',
        'Продюсер',
        'Каналов',
        'Подписчики',
        'Просмотры',
        'Лайки',
        'Ролики',
      ],
      ...matching.map((row) => [
        row.name,
        row.producerName ?? '',
        row.channelCount,
        row.followersCount ? row.followers : '',
        row.totalViewsCount ? row.totalViews : '',
        row.totalLikesCount ? row.totalLikes : '',
        row.publicationCountCount ? row.publicationCount : '',
      ]),
      [
        `ИТОГО ${type}`,
        '',
        totals.channels,
        totals.followersCount ? totals.followers : '',
        totals.viewsCount ? totals.views : '',
        totals.totalLikesCount ? totals.totalLikes : '',
        totals.publicationsCount ? totals.publications : '',
      ],
    ],
  } satisfies Sheet;
}

const syncLabels: Record<ChannelSyncStatus, string> = {
  pending: 'В очереди',
  syncing: 'Обновляется',
  success: 'Синхронизирован',
  error: 'Ошибка',
  needs_auth: 'Нужен доступ',
};

const freshnessLabels = {
  fresh: 'Свежие',
  aging: 'Обновлялись недавно',
  stale: 'Данные устарели',
  never: 'Данных пока нет',
};

export function createGoogleSheetsWorkbook(data: ReportExportData) {
  const activeCount = data.channels.filter(
    (channel) => channel.status === 'active',
  ).length;
  const errorCount = data.channels.filter(
    (channel) => channel.lastSyncStatus === 'error',
  ).length;
  const needsAuthCount = data.channels.filter(
    (channel) => channel.lastSyncStatus === 'needs_auth',
  ).length;
  const successCount = data.channels.filter(
    (channel) => channel.lastSyncStatus === 'success',
  ).length;
  const summaryRows: Cell[][] = [
    ['Показатель', 'Значение', '', '', '', '', ''],
    ['Период', data.period ? `${data.period.from} — ${data.period.to} включительно, Москва (UTC+3)` : 'Текущие накопленные итоги'],
    ['Расчёт', data.period ? 'Прирост счётчиков между ежедневными снимками. Это не только просмотры новых роликов. Снимки могут отстоять от границы до 36 часов; точное время указано на листе «Снимки периода». Подписчики — на конец периода. Корректировки текущих итогов не применяются.' : 'Текущие показатели с учётом ручных корректировок. Просмотры — не уникальный охват.'],
    ['Каналов в текущей выборке', data.metrics.channelCount],
    ['Активных каналов', activeCount],
    ['Синхронизированы', successCount],
    ['С ошибкой', errorCount],
    ['Требуют авторизации', needsAuthCount],
    ['Креаторов', data.metrics.creatorCount],
    [
      'Подписчиков',
      data.metrics.followersCount ? data.metrics.followers : 'Нет данных',
    ],
    [
      'Просмотры',
      data.metrics.totalViewsCount ? data.metrics.totalViews : 'Нет данных',
    ],
    [
      'Роликов',
      data.metrics.publicationCountCount
        ? data.metrics.publicationCount
        : 'Нет данных',
    ],
    [
      'Лайки',
      data.metrics.totalLikesCount ? data.metrics.totalLikes : 'Нет данных',
    ],
    ['Каналов с просмотрами', data.metrics.totalViewsCount],
    ['Каналов с числом роликов', data.metrics.publicationCountCount],
    ['Каналов с лайками', data.metrics.totalLikesCount],
    ['UGC-креаторов', data.ugc.creatorCount],
    ['UGC-каналов', data.ugc.channelCount],
    [
      'Просмотры UGC-каналов',
      data.ugc.totalViewsCount ? data.ugc.totalViews : 'Нет данных',
    ],
    ['AI-креаторов', data.ai.creatorCount],
    ['AI-каналов', data.ai.channelCount],
    [
      'Просмотры AI-каналов',
      data.ai.totalViewsCount ? data.ai.totalViews : 'Нет данных',
    ],
    [
      'Примечание',
      'Пустая ячейка означает отсутствие данных, а не ноль. Итоги — только по каналам с доступным показателем. Ролики — счётчик видео площадки; фотографии Instagram не включаются.',
    ],
    ['', '', '', '', '', '', ''],
    [
      'Продюсер',
      'Креаторов',
      'Каналов',
      'Подписчики',
      'Просмотры',
      'Лайки',
      'Ролики',
    ],
    ...data.producerRows.map((row) => [
      row.name,
      row.creatorCount ?? 0,
      row.channelCount,
      row.followersCount ? row.followers : '',
      row.totalViewsCount ? row.totalViews : '',
      row.totalLikesCount ? row.totalLikes : '',
      row.publicationCountCount ? row.publicationCount : '',
    ]),
  ];
  const sheets: Sheet[] = [
    {
      name: 'Общая статистика',
      rows: summaryRows,
      widths: [48, 32, 14, 18, 20, 18, 16],
    },
    {
      name: 'Каналы',
      widths: [
        16, 28, 20, 24, 10, 22, 54, 24, 24, 18, 20, 18, 16, 16, 22, 24, 22, 22, 42,
      ],
      rows: [
        [
          'Площадка',
          'Канал',
          'Хэндл',
          'Креатор',
          'Тип',
          'Продюсер',
          'Ссылка',
          'Telegram креатора',
          'Telegram продюсера',
          'Подписчики',
          'Просмотры',
          'Лайки',
          'Ролики',
          'Статус канала',
          'Статус синхронизации',
          'Последняя синхронизация',
          'Свежесть',
          'Источник',
          'Ошибка',
        ],
        ...data.channels.map((channel) => {
          const metrics = effectiveChannelMetrics(channel);
          return [
            channel.platformName,
            channel.title || channel.handle || channel.platformName,
            channel.handle ?? '',
            channel.creatorName,
            channel.creatorType,
            channel.producerName,
            channel.url,
            channel.creatorTelegramUsername ? `@${channel.creatorTelegramUsername}` : channel.creatorTelegramId ?? 'Не привязан',
            channel.producerTelegramUsername ? `@${channel.producerTelegramUsername}` : channel.producerTelegramId ?? 'Не привязан',
            metrics.followers ?? '',
            metrics.totalViews ?? '',
            metrics.totalLikes ?? '',
            metrics.publicationCount ?? '',
            channel.status === 'active' ? 'Активен' : 'Неактивен',
            channel.lastSyncStatus
              ? syncLabels[channel.lastSyncStatus]
              : 'Нет синхронизации',
            channel.lastSyncAt ?? '',
            freshnessLabels[getFreshness(channel.lastSyncAt)],
            channel.parserSource ?? '',
            channel.lastSyncError ?? '',
          ];
        }),
      ],
    },
    creatorSheet('UGC', data.creatorRows),
    creatorSheet('AI', data.creatorRows),
  ];

  if (data.period) sheets.push({ name: 'Снимки периода', widths: [26, 54, 26, 26, 20, 20, 20, 20, 20, 20, 80], rows: [
    ['Креатор', 'Канал', 'Снимок начала (UTC)', 'Снимок конца (UTC)', 'Просмотры в начале', 'Просмотры в конце', 'Ролики в начале', 'Ролики в конце', 'Лайки в начале', 'Лайки в конце', 'Полнота данных'],
    ...data.channels.map((channel) => { const p = channel.periodData; return [channel.creatorName, channel.url, p?.baselineAt ?? '', p?.endAt ?? '', p?.startViews ?? '', p?.endViews ?? '', p?.startVideos ?? '', p?.endVideos ?? '', p?.startLikes ?? '', p?.endLikes ?? '', p?.note ?? 'Истории нет']; }),
  ] });
  return createWorkbook(sheets);
}

export function downloadGoogleSheetsReport(data: ReportExportData) {
  const bytes = createGoogleSheetsWorkbook(data);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `kontent-zavod-${data.period ? `${data.period.from}_${data.period.to}` : `itogi-${new Date().toISOString().slice(0, 10)}`}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}
