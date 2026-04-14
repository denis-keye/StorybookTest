// Shared GitHub Contents API helpers for the Vercel API routes.
// All writes go to a per-user working branch derived from the GitHub token.
// The token is read from the GITHUB_TOKEN env var (set in Vercel dashboard).

const BASE = 'https://api.github.com';

function env() {
  return {
    token:  process.env.GITHUB_TOKEN  ?? '',
    owner:  process.env.GITHUB_OWNER  ?? '',
    repo:   process.env.GITHUB_REPO   ?? '',
    branch: process.env.GITHUB_BRANCH ?? 'main',
  };
}

function headers(token: string) {
  return {
    Authorization: `token ${token}`,
    Accept:        'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
}

export interface GithubFileResult {
  content:  string; // decoded UTF-8 content
  sha:      string; // blob SHA needed for updates
  encoding: string;
}

/** GET /repos/:owner/:repo/contents/:path on a given branch */
export async function getFile(
  filePath: string,
  branch?: string,
  token?: string,
  owner?: string,
  repo?: string,
): Promise<GithubFileResult> {
  const e = env();
  const t = token  ?? e.token;
  const o = owner  ?? e.owner;
  const r = repo   ?? e.repo;
  const b = branch ?? e.branch;
  const url = `${BASE}/repos/${o}/${r}/contents/${filePath}?ref=${b}`;
  const res = await fetch(url, { headers: headers(t) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub GET ${filePath}: ${res.status} ${err}`);
  }
  const data = await res.json() as { content: string; sha: string; encoding: string };
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha, encoding: data.encoding };
}

/** PUT /repos/:owner/:repo/contents/:path — create or update a file */
export async function putFile(
  filePath: string,
  content:  string,
  message:  string,
  sha:      string | null,
  branch:   string,
  token?: string,
  owner?: string,
  repo?: string,
): Promise<void> {
  const e = env();
  const t = token ?? e.token;
  const o = owner ?? e.owner;
  const r = repo  ?? e.repo;
  const url  = `${BASE}/repos/${o}/${r}/contents/${filePath}`;
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers: headers(t), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${filePath}: ${res.status} ${err}`);
  }
}

/** Ensure a branch exists, creating it from BASE_BRANCH if needed. */
export async function ensureBranch(
  branch: string,
  token?: string,
  owner?: string,
  repo?: string,
): Promise<void> {
  const e = env();
  const t = token ?? e.token;
  const o = owner ?? e.owner;
  const r = repo  ?? e.repo;
  const b = e.branch;
  const checkUrl = `${BASE}/repos/${o}/${r}/git/refs/heads/${branch}`;
  const check    = await fetch(checkUrl, { headers: headers(t) });
  if (check.status === 200) return;

  const baseRes  = await fetch(`${BASE}/repos/${o}/${r}/git/refs/heads/${b}`, { headers: headers(t) });
  if (!baseRes.ok) throw new Error(`Cannot find base branch ${b}`);
  const baseData = await baseRes.json() as { object: { sha: string } };
  const sha      = baseData.object.sha;

  const createRes = await fetch(`${BASE}/repos/${o}/${r}/git/refs`, {
    method:  'POST',
    headers: headers(t),
    body:    JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Cannot create branch ${branch}: ${createRes.status} ${err}`);
  }
}

/** Derive a stable per-token working branch name ("design/abc123") */
export function workingBranch(token?: string): string {
  const t  = token ?? env().token;
  const id = t.slice(-8).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'shared';
  return `design/${id}`;
}

/** Convenience accessors for the route files that need raw values */
export function getEnv() { return env(); }
