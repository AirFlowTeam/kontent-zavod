'use client';

import { strToU8, zipSync } from 'fflate';

import type { Metrics, SummaryRow, Video } from '@/lib/content-types';

type Cell = string | number;
type Sheet = { name: string; rows: Cell[][]; widths: number[] };

export interface ReportExportData {
  period: string;
  metrics: Metrics;
  ugc: Metrics;
  ai: Metrics;
  videos: Video[];
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
      const cells = row.map((cell, columnIndex) => {
        const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
        const header = rowIndex === 0 || (sheet.name === 'Общая статистика' && rowIndex === 13);
        const style = header ? 1 : typeof cell === 'number' ? 2 : 0;
        if (typeof cell === 'number') return `<c r="${ref}" s="${style}"><v>${cell}</v></c>`;
        return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${escapeXml(cell)}</t></is></c>`;
      }).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  const cols = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const lastColumn = columnName(Math.max(...sheet.rows.map((row) => row.length), 1) - 1);
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
  const put = (path: string, value: string) => { files[path] = strToU8(value); };
  put('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
    </Types>`);
  put('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`);
  put('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
    </workbook>`);
  put('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
      <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    </Relationships>`);
  put('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts>
      <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5B3FD3"/><bgColor indexed="64"/></patternFill></fill></fills>
      <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`);
  sheets.forEach((sheet, index) => put(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)));
  return zipSync(files, { level: 6 });
}

function creatorSheet(type: 'UGC' | 'AI', rows: SummaryRow[]) {
  const matching = rows.filter((row) => row.type === type);
  const totalVideos = matching.reduce((sum, row) => sum + row.videoCount, 0);
  const totalReach = matching.reduce((sum, row) => sum + row.reach, 0);
  return {
    name: `${type}-креаторы`,
    widths: [24, 22, 14, 18, 18],
    rows: [
      ['Креатор', 'Продюсер', 'Роликов', 'Общий охват', 'Средний охват'],
      ...matching.map((row) => [row.name, row.producerName ?? '', row.videoCount, row.reach, row.average]),
      [`ИТОГО ${type}`, '', totalVideos, totalReach, totalVideos ? Math.round(totalReach / totalVideos) : 0],
    ],
  } satisfies Sheet;
}

export function createGoogleSheetsWorkbook(data: ReportExportData) {
  const summaryRows: Cell[][] = [
    ['Показатель', 'Значение', '', '', ''],
    ['Период', data.period],
    ['Всего креаторов', data.metrics.creatorCount],
    ['Всего роликов', data.metrics.videoCount],
    ['Общий охват', data.metrics.reach],
    ['Средний охват ролика', data.metrics.average],
    ['UGC-креаторов', data.ugc.creatorCount],
    ['UGC-роликов', data.ugc.videoCount],
    ['Охват UGC', data.ugc.reach],
    ['AI-креаторов', data.ai.creatorCount],
    ['AI-роликов', data.ai.videoCount],
    ['Охват AI', data.ai.reach],
    ['', '', '', '', ''],
    ['Продюсер', 'Креаторов', 'Роликов', 'Общий охват', 'Средний охват'],
    ...data.producerRows.map((row) => [row.name, row.creatorCount ?? 0, row.videoCount, row.reach, row.average]),
  ];
  const sheets: Sheet[] = [
    { name: 'Общая статистика', rows: summaryRows, widths: [28, 18, 15, 20, 20] },
    {
      name: 'Все ролики',
      widths: [15, 22, 10, 20, 16, 54, 16, 14],
      rows: [
        ['Дата', 'Креатор', 'Тип', 'Продюсер', 'Площадка', 'Ссылка', 'Охват', 'Статус'],
        ...data.videos.map((video) => [video.publishedAt, video.creatorName, video.creatorType, video.producerName, video.platformName, video.url, video.reach, video.status === 'active' ? 'Активен' : video.status === 'error' ? 'Ошибка' : 'Удалён']),
      ],
    },
    creatorSheet('UGC', data.creatorRows),
    creatorSheet('AI', data.creatorRows),
  ];

  return createWorkbook(sheets);
}

export function downloadGoogleSheetsReport(data: ReportExportData) {
  const bytes = createGoogleSheetsWorkbook(data);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `kontent-zavod-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}
