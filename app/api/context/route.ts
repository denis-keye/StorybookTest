import { type NextRequest, NextResponse } from 'next/server';
import { getFile, putFile, ensureBranch, workingBranch } from '@/lib/github-api';

function contextFilePath(component: string): string {
  return `components/${component}/${component}.context.json`;
}

export async function GET(req: NextRequest) {
  const component = req.nextUrl.searchParams.get('component');
  if (!component) return NextResponse.json({ error: 'component param required' }, { status: 400 });

  try {
    const { content } = await getFile(contextFilePath(component));
    return NextResponse.json(JSON.parse(content));
  } catch {
    return NextResponse.json({});
  }
}

export async function POST(req: NextRequest) {
  try {
    const { component, data } = await req.json() as { component: string; data: unknown };
    if (!component || !data) return NextResponse.json({ error: 'component + data required' }, { status: 400 });

    const filePath = contextFilePath(component);
    const branch   = workingBranch();
    await ensureBranch(branch);

    let sha: string | null = null;
    try { ({ sha } = await getFile(filePath, branch)); } catch { /* new file */ }

    await putFile(filePath, JSON.stringify(data, null, 2) + '\n', `design: update ${component} context`, sha, branch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
