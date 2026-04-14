import { type NextRequest, NextResponse } from 'next/server';
import { workingBranch, getEnv, ensureBranch } from '@/lib/github-api';

export async function POST(req: NextRequest) {
  try {
    const { title, body = '' } = await req.json() as { title: string; body?: string };

    if (!title?.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const { token, owner, repo, branch: baseBranch } = getEnv();
    if (!token) {
      return NextResponse.json({ error: 'GITHUB_TOKEN not configured on the server' }, { status: 400 });
    }

    const branch = workingBranch();

    // Ensure the head branch exists — if Save was never clicked it may not exist yet
    await ensureBranch(branch);

    // Check for an existing open PR on this head branch
    const existingRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
      { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } },
    );
    if (existingRes.ok) {
      const existing = await existingRes.json() as Array<{ html_url: string; number: number }>;
      if (existing.length > 0) {
        return NextResponse.json({ ok: true, url: existing[0].html_url, branch, prNumber: existing[0].number, existing: true });
      }
    }

    // Check if there are any commits ahead of base before trying to open a PR
    const compareRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/compare/${baseBranch}...${branch}`,
      { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } },
    );
    if (compareRes.ok) {
      const cmp = await compareRes.json() as { ahead_by: number };
      if (cmp.ahead_by === 0) {
        return NextResponse.json({ error: 'No changes to PR — use Save first to commit your changes to a branch.' }, { status: 422 });
      }
    }

    const prBody  = `${body}\n\n---\n*Created from the Storybook Design Panel*`;

    const apiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        Accept:         'application/vnd.github.v3+json',
      },
      body: JSON.stringify({ title, body: prBody, head: branch, base: baseBranch }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.json() as { message?: string; errors?: Array<{ message: string }> };
      const detail = err.errors?.map(e => e.message).join('; ') ?? err.message ?? `GitHub API ${apiRes.status}`;
      throw new Error(detail);
    }

    const pr = await apiRes.json() as { html_url: string; number: number };
    return NextResponse.json({ ok: true, url: pr.html_url, branch, prNumber: pr.number });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
