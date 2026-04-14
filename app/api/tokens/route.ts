import { type NextRequest, NextResponse } from 'next/server';
import { getFile, putFile, ensureBranch, workingBranch } from '@/lib/github-api';
import { parseTokens, updateTokenInCss } from '@/lib/css-tokens';

const TOKENS_FILE = 'app/globals.css';

export async function GET() {
  try {
    const { content } = await getFile(TOKENS_FILE);
    const tokens = parseTokens(content);
    return NextResponse.json(tokens);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, value } = await req.json() as { name: string; value: string };
    if (!name || value === undefined) {
      return NextResponse.json({ error: 'name + value required' }, { status: 400 });
    }

    const branch = workingBranch();
    await ensureBranch(branch);

    const { content, sha } = await getFile(TOKENS_FILE, branch);
    let updated = updateTokenInCss(content, name, value);
    if (updated === content) {
      updated = content.replace(/(:root\s*{)/, `$1\n  ${name}: ${value};`);
    }

    await putFile(TOKENS_FILE, updated, `design: update ${name}`, sha, branch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
