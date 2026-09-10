import { getPeriodReport } from '@/db/report';
import { validateReportPeriod } from '@/lib/report-period';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const from = query.get('from') || '', to = query.get('to') || '';
  try { validateReportPeriod(from, to); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  try { return Response.json(await getPeriodReport(from, to), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Не удалось загрузить историю периода. Попробуйте ещё раз.' }, { status: 500 }); }
}
