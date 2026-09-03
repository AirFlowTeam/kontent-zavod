import { getDashboardData } from '@/db/storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getDashboardData();
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Не удалось загрузить данные. Попробуйте ещё раз.' }, { status: 500 });
  }
}
