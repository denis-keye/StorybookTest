// Shared GitHub Contents API helpers for the Vercel API routes.
// All writes go to a per-user working branch derived from the GitHub token.
// The token is read from the GITHUB_TOKEN env var (set in Vercel dashboard).

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const OWNER        = process.env.GITHUB_OWNER  ?? '';
const REPO         = process.env.GITHUB_REPO   ?? '';
const BASE_BRANCH  = process.env.GITHUB_BRANCH ?? 'main';

const BASE = 'https://api.github.com';

function headers(token = GITHUB_TOKEN) {
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
  branch = BASE_BRANCH,
  token   = GITHUB_TOKEN,
  owner   = OWNER,
  repo    = REPO,
): Promise<GithubFileResult> {
  const url = `${BASE}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
  const res = await fetch(url, { headers: headers(token) });
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
  sha:      string | null,   // null = create new file
  branch:   string,
  token   = GITHUB_TOKEN,
  owner   = OWNER,
  repo    = REPO,
): Promise<void> {
  const url  = `${BASE}/repos/${owner}/${repo}/contents/${filePath}`;
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers: headers(token), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${filePath}: ${res.status} ${err}`);
  }
}

/** Ensure a branch exists, creating it from BASE_BRANCH if needed. */
export async function ensureBranch(
  branch: string,
  token = GITHUB_TOKEN,
  owner = OWNER,
  repo  = REPO,
): Promise<void> {
  const checkUrl = `${BASE}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
  const check    = await fetch(checkUrl, { headers: headers(token) });
  if (check.status === 200) return; // already exists

  // Get SHA of base branch tip
  const baseRes  = await fetch(`${BASE}/repos/${owner}/${repo}/git/refs/heads/${BASE_BRANCH}`, { headers: headers(token) });
  if (!baseRes.ok) throw new Error(`Cannot find base branch ${BASE_BRANCH}`);
  const baseData = await baseRes.json() as { object: { sha: string } };
  const sha      = baseData.object.sha;

  const createRes = await fetch(`${BASE}/repos/${owner}/${repo}/git/refs`, {
    method:  'POST',
    headers: headers(token),
    body:    JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Cannot create branch ${branch}: ${createRes.status} ${err}`);
  }
}

/** Derive a stable per-token working branch name ("design/abc123") */
export function workingBranch(token = GITHUB_TOKEN): string {
  // Use last 8 chars of token as a stable short ID
  const id = token.slice(-8).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'shared';
  return `design/${id}`;
}

export { OWNER, REPO, BASE_BRANCH, GITHUB_TOKEN };
