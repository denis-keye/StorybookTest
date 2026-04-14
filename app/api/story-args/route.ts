import { type NextRequest, NextResponse } from 'next/server';
import { getFile, putFile, ensureBranch, workingBranch } from '@/lib/github-api';
import { storyExportName, patchStoryArg } from '@/lib/css-tokens';

const STORIES_DIR    = 'stories';
const COMPONENTS_DIR = 'components';

/** Map a storyId like "ui-badge--destructive" to a file path in the repo. */
async function findStoryFilePath(storyId: string): Promise<string | null> {
  const segments  = storyId.split('--')[0].split('-');
  const candidates: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    candidates.push(segments.slice(i).join(''));
  }

  // Fetch directory listings from GitHub
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
          if (normalized === candidate) return f.path;
        }
      }
    } catch { continue; }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { storyId, prop, value } = await req.json() as {
      storyId: string; prop: string; value: string;
    };

    const filePath = await findStoryFilePath(storyId);
    if (!filePath) {
      return NextResponse.json({ error: 'Story file not found', storyId }, { status: 404 });
    }

    const branch = workingBranch();
    await ensureBranch(branch);

    const { content: src, sha } = await getFile(filePath, branch);
    const exportName = storyExportName(storyId);
    const patched    = patchStoryArg(src, exportName, prop, value);
    if (!patched) {
      return NextResponse.json({ error: `Could not find export "${exportName}" in ${filePath}` }, { status: 422 });
    }

    await putFile(filePath, patched, `design: update ${exportName} ${prop}`, sha, branch);
    return NextResponse.json({ ok: true, file: filePath });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
