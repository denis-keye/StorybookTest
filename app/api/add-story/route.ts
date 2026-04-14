import { type NextRequest, NextResponse } from 'next/server';
import { getFile, putFile, ensureBranch, workingBranch } from '@/lib/github-api';
import { storyExportName } from '@/lib/css-tokens';

const STORIES_DIR    = 'stories';
const COMPONENTS_DIR = 'components';

async function findStoryFilePath(storyId: string): Promise<string | null> {
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
          if (normalized === candidate) return f.path;
        }
      }
    } catch { continue; }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { storyId, name, args = {} } = await req.json() as {
      storyId: string; name: string; args?: Record<string, unknown>;
    };

    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const exportName = name.trim()
      .split(/[\s_-]+/)
      .map(w => w[0]?.toUpperCase() + w.slice(1))
      .join('');

    const filePath = await findStoryFilePath(storyId);
    if (!filePath) return NextResponse.json({ error: 'Story file not found', storyId }, { status: 404 });

    const branch = workingBranch();
    await ensureBranch(branch);

    const { content: src, sha } = await getFile(filePath, branch);

    if (src.includes(`export const ${exportName}`)) {
      return NextResponse.json({ error: `Story "${exportName}" already exists` }, { status: 409 });
    }

    const baseExport   = storyExportName(storyId);
    const argsEntries  = Object.entries(args);
    let argsBlock: string;
    if (argsEntries.length > 0) {
      const inner = argsEntries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
      argsBlock   = `{ args: { ...${baseExport}.args, ${inner} } }`;
    } else {
      argsBlock = `{ args: { ...${baseExport}.args } }`;
    }

    const newExport = `\nexport const ${exportName}: Story = ${argsBlock};\n`;
    const updated   = src.trimEnd() + '\n' + newExport;

    await putFile(filePath, updated, `design: add story ${exportName}`, sha, branch);
    return NextResponse.json({ ok: true, exportName, file: filePath });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
