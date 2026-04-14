import { type NextRequest, NextResponse } from 'next/server';
import { workingBranch, getEnv } from '@/lib/github-api';

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

    const branch  = workingBranch();
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
      const err = await apiRes.json() as { message?: string };
      throw new Error(err.message ?? `GitHub API ${apiRes.status}`);
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
