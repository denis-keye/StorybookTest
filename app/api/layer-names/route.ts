import { type NextRequest, NextResponse } from 'next/server';
import { getFile, putFile, ensureBranch, workingBranch, GITHUB_TOKEN } from '@/lib/github-api';

const STORIES_DIR    = 'stories';
const COMPONENTS_DIR = 'components';

async function findMetaFilePath(storyId: string): Promise<string | null> {
  const segments  = storyId.split('--')[0].split('-');
  const candidates: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    candidates.push(segments.slice(i).join(''));
  }

  const dirs = [STORIES_DIR, COMPONENTS_DIR];
  for (const dir of dirs) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${dir}?ref=${process.env.GITHUB_BRANCH ?? 'main'}`,
        { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } },
      );
      if (!res.ok) continue;
      const files = await res.json() as Array<{ name: string; path: string; type: string }>;
      for (const candidate of candidates) {
        for (const f of files) {
          if (f.type !== 'file') continue;
          const normalized = f.name.replace(/\.stories\.(tsx?|jsx?)$/, '').toLowerCase().replace(/-/g, '');
          if (normalized === candidate) {
            return f.path.replace(/\.stories\.(tsx?|jsx?)$/, '.stories.meta.json');
          }
        }
      }
    } catch { continue; }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const storyId = req.nextUrl.searchParams.get('storyId');
  if (!storyId) return NextResponse.json({ error: 'storyId required' }, { status: 400 });

  try {
    const metaPath = await findMetaFilePath(storyId);
    if (!metaPath) return NextResponse.json({});

    const { content } = await getFile(metaPath);
    return NextResponse.json(JSON.parse(content));
  } catch {
    return NextResponse.json({});
  }
}

export async function POST(req: NextRequest) {
  try {
    const { storyId, layerNames } = await req.json() as {
      storyId: string; layerNames: Record<string, string>;
    };

    const metaPath = await findMetaFilePath(storyId);
    if (!metaPath) return NextResponse.json({ error: 'Story file not found' }, { status: 404 });

    const branch = workingBranch(GITHUB_TOKEN);
    await ensureBranch(branch);

    let existing: Record<string, unknown> = {};
    let sha: string | null = null;
    try {
      const f = await getFile(metaPath, branch);
      existing = JSON.parse(f.content);
      sha      = f.sha;
    } catch { /* file doesn't exist yet */ }

    const merged  = { ...existing, layerNames };
    await putFile(metaPath, JSON.stringify(merged, null, 2) + '\n', `design: update layer names for ${storyId}`, sha, branch);
    return NextResponse.json({ ok: true, file: metaPath });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
