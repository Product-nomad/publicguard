import type { SearchResult, SeedQuery } from "./types.js";

const GITHUB_API = "https://api.github.com";
const RESULTS_PER_PAGE = 10;

export class GitHubSearchClient {
  private readonly token: string;
  private readonly headers: Record<string, string>;

  constructor(token: string) {
    this.token = token;
    this.headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "publicguard/0.1.0 (good-faith secret-leak notifier)",
    };
  }

  /**
   * Run one seed query and return raw file results.
   * Respects GitHub's 10 results-per-page minimum for code search.
   * Returns at most `limit` items.
   */
  async searchCode(query: SeedQuery, limit = 10): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query.q,
      per_page: String(Math.min(limit, RESULTS_PER_PAGE)),
    });
    const url = `${GITHUB_API}/search/code?${params.toString()}`;

    const resp = await fetch(url, { headers: this.headers });

    if (resp.status === 403 || resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      const reset = resp.headers.get("X-RateLimit-Reset");
      throw new RateLimitError(resp.status, retryAfter, reset);
    }

    if (!resp.ok) {
      throw new Error(
        `GitHub Code Search failed: ${resp.status} ${resp.statusText}`,
      );
    }

    const body = (await resp.json()) as { items?: GitHubCodeItem[] };
    const items = body.items ?? [];

    const results: SearchResult[] = [];
    for (const item of items.slice(0, limit)) {
      results.push({
        repo: item.repository.full_name,
        repoOwner: item.repository.owner.login,
        repoName: item.repository.name,
        filePath: item.path,
        commitSha: item.sha,
        fileUrl: item.html_url,
        rawContent: "",
      });
    }
    return results;
  }

  /**
   * Check whether a file exists in a repo (HEAD request — no content downloaded).
   * Used to check for .publicguard-ignore before fetching anything else.
   */
  async fileExists(owner: string, repo: string, path: string): Promise<boolean> {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
    const resp = await fetch(url, { method: "HEAD", headers: this.headers });
    return resp.ok;
  }

  /**
   * Fetch raw file content from a repo.
   * Returns empty string on error rather than throwing — a 404 is fine
   * (file deleted since search index was built).
   */
  async fetchFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string> {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;
    const resp = await fetch(url, {
      headers: { ...this.headers, Accept: "application/vnd.github.raw+json" },
    });
    if (!resp.ok) return "";
    return resp.text();
  }

  /**
   * Post an issue to a public repo. Requires the PAT to have `public_repo` scope.
   */
  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
  ): Promise<{ url: string; number: number }> {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/issues`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(
        `Failed to post issue to ${owner}/${repo}: ${resp.status} ${detail}`,
      );
    }
    const data = (await resp.json()) as { html_url: string; number: number };
    return { url: data.html_url, number: data.number };
  }
}

export class RateLimitError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds: number | null;
  readonly resetAt: Date | null;

  constructor(
    statusCode: number,
    retryAfter: string | null,
    resetUnix: string | null,
  ) {
    const waitSec = retryAfter ? parseInt(retryAfter, 10) : null;
    const resetDate = resetUnix ? new Date(parseInt(resetUnix, 10) * 1000) : null;
    const msg = resetDate
      ? `GitHub rate limit hit — resets at ${resetDate.toISOString()}`
      : "GitHub rate limit hit";
    super(msg);
    this.name = "RateLimitError";
    this.statusCode = statusCode;
    this.retryAfterSeconds = waitSec;
    this.resetAt = resetDate;
  }
}

interface GitHubCodeItem {
  sha: string;
  path: string;
  html_url: string;
  repository: {
    full_name: string;
    name: string;
    owner: { login: string };
  };
}
