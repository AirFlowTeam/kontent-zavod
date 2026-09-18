import { metaCallbackResponse } from '@/db/meta-callbacks';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  return metaCallbackResponse(request, provider, 'data-deletion');
}
