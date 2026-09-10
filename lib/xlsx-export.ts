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
      reach30d: result.reach30d + row.reach30d,
      reach30dCount: result.reach30dCount + row.reach30dCount,
      publications: result.publications + row.publicationCount,
      publicationsCount: result.publicationsCount + row.publicationCountCount,
    }),
    {
      channels: 0,
      followers: 0,
      followersCount: 0,
      views: 0,
      viewsCount: 0,
      reach30d: 0,
      reach30dCount: 0,
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
        'Охваты каналов',
        'Охват 30 дней',
        'Публикации',
      ],
      ...matching.map((row) => [
        row.name,
        row.producerName ?? '',
        row.channelCount,
        row.followersCount ? row.followers : '',
        row.totalViewsCount ? row.totalViews : '',
        row.reach30dCount ? row.reach30d : '',
        row.publicationCountCount ? row.publicationCount : '',
      ]),
      [
        `ИТОГО ${type}`,
        '',
        totals.channels,
        totals.followersCount ? totals.followers : '',
        totals.viewsCount ? totals.views : '',
        totals.reach30dCount ? totals.reach30d : '',
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
      'Охваты каналов',
      data.metrics.totalViewsCount ? data.metrics.totalViews : 'Нет данных',
    ],
    [
      'Публикаций',
      data.metrics.publicationCountCount
        ? data.metrics.publicationCount
        : 'Нет данных',
    ],
    [
      'Охват за 30 дней',
      data.metrics.reach30dCount ? data.metrics.reach30d : 'Нет данных',
    ],
    ['Каналов с охватом за 30 дней', data.metrics.reach30dCount],
    ['UGC-креаторов', data.ugc.creatorCount],
    ['UGC-каналов', data.ugc.channelCount],
    [
      'Охваты UGC-каналов',
      data.ugc.totalViewsCount ? data.ugc.totalViews : 'Нет данных',
    ],
    ['AI-креаторов', data.ai.creatorCount],
    ['AI-каналов', data.ai.channelCount],
    [
      'Охваты AI-каналов',
      data.ai.totalViewsCount ? data.ai.totalViews : 'Нет данных',
    ],
    [
      'Примечание',
      'Метрики — effective-значения площадок с учётом явно заданных корректировок. Охват за 30 дней суммируется только по каналам, где он доступен.',
    ],
    ['', '', '', '', '', '', ''],
    [
      'Продюсер',
      'Креаторов',
      'Каналов',
      'Подписчики',
      'Охваты каналов',
      'Охват 30 дней',
      'Публикации',
    ],
    ...data.producerRows.map((row) => [
      row.name,
      row.creatorCount ?? 0,
      row.channelCount,
      row.followersCount ? row.followers : '',
      row.totalViewsCount ? row.totalViews : '',
      row.reach30dCount ? row.reach30d : '',
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
          'Охваты канала',
          'Охват 30 дней',
          'Публикации',
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
            metrics.reach30d ?? '',
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
  link.download = `kontent-zavod-kanaly-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}
