import { type NextRequest, NextResponse } from 'next/server';
import { getFile } from '@/lib/github-api';

const STORIES_DIR    = 'stories';
const COMPONENTS_DIR = 'components';

async function findMetaFilePath(storyId: string): Promise<string | null> {
  const componentSlug = storyId.split('--')[0];
  const segments = componentSlug.split('-');
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
          if (f.type !== 'file' || !f.name.endsWith('.meta.json')) continue;
          const normalized = f.name.replace(/\.stories\.meta\.json$/, '').toLowerCase().replace(/-/g, '');
          if (normalized === candidate) return f.path;
        }
      }
    } catch { continue; }
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const storyId = req.nextUrl.searchParams.get('storyId');
    if (!storyId) return NextResponse.json({ variants: {} });

    const filePath = await findMetaFilePath(storyId);
    if (!filePath) return NextResponse.json({ variants: {} });

    const { content } = await getFile(filePath, process.env.GITHUB_BRANCH ?? 'main');
    const meta = JSON.parse(content) as { variants?: Record<string, string[]>; combos?: Record<string, string> };

    const variants: Record<string, string[]> = meta.variants ?? {};
    if (meta.combos && Object.keys(variants).length === 0) {
      variants['combos'] = Object.keys(meta.combos);
    }

    return NextResponse.json({ variants });
  } catch (e) {
    return NextResponse.json({ variants: {}, error: String(e) });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
