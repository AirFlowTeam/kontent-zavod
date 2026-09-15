import guide from '@/deploy/vps/API-ADMIN-GUIDE.md?raw';
export async function GET() {
  return new Response(guide, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="kontent-zavod-api-admin.md"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
