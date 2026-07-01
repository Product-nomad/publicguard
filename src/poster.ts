import type { DB } from "./db.js";
import { checkGuardrails } from "./guardrails.js";
import type { GitHubSearchClient } from "./github-search.js";
import { renderIssueBody, renderIssueTitle } from "./template.js";
import type { QueuedFinding } from "./types.js";

export interface PostOptions {
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}

export interface PostSummary {
  attempted: number;
  posted: number;
  skipped: number;
  blocked: string | null;
}

/**
 * Post approved findings as GitHub Issues, one issue per (repo, file) group.
 * Multiple detectors firing on the same file are consolidated into one issue.
 */
export async function postApproved(
  db: DB,
  client: GitHubSearchClient,
  opts: PostOptions = {},
): Promise<PostSummary> {
  const log = opts.onProgress ?? (() => undefined);
  const summary: PostSummary = {
    attempted: 0,
    posted: 0,
    skipped: 0,
    blocked: null,
  };

  const approved = db.getByStatus("approved");
  if (approved.length === 0) {
    log("No approved findings to post.");
    return summary;
  }

  // Group by (repo, filePath) — one issue per file.
  const groups = groupByFile(approved);
  log(`${groups.length} file group(s) to post across ${countRepos(groups)} repo(s).`);

  for (const group of groups) {
    const first = group[0];
    if (!first) continue;

    const guard = checkGuardrails(db);
    if (!guard.allowed) {
      summary.blocked = guard.reason ?? "Guardrail blocked posting";
      log(`Posting blocked: ${summary.blocked}`);
      break;
    }

    summary.attempted++;

    if (opts.dryRun) {
      log(formatDryRun(group));
      summary.skipped++;
      continue;
    }

    try {
      const title = renderIssueTitle(group);
      const body = renderIssueBody(group);
      const result = await client.createIssue(
        first.repoOwner,
        first.repoName,
        title,
        body,
      );
      for (const finding of group) {
        db.markPosted(finding.id, result.url, result.number);
      }
      db.incrementPostCount();
      summary.posted++;
      log(`  Posted #${result.number}: ${result.url}`);
      await sleep(3000);
    } catch (err) {
      log(`  Error posting to ${first.repo}: ${String(err)}`);
      summary.skipped++;
    }
  }

  return summary;
}

function groupByFile(findings: QueuedFinding[]): QueuedFinding[][] {
  const map = new Map<string, QueuedFinding[]>();
  for (const f of findings) {
    const key = `${f.repo}::${f.filePath}`;
    const group = map.get(key) ?? [];
    group.push(f);
    map.set(key, group);
  }
  return [...map.values()];
}

function countRepos(groups: QueuedFinding[][]): number {
  return new Set(groups.map((g) => g[0]?.repo).filter(Boolean)).size;
}

function formatDryRun(group: QueuedFinding[]): string {
  const first = group[0];
  if (!first) return "";
  const labels = [...new Set(group.map((f) => f.detectorLabel))];
  return [
    `[DRY RUN] Would post to: ${first.repo}`,
    `  File:        ${first.filePath}`,
    `  Credentials: ${labels.join(", ")}`,
    `  Commit:      ${first.commitSha.slice(0, 7)}`,
    `  Body preview:`,
    renderIssueBody(group)
      .split("\n")
      .slice(0, 6)
      .map((l) => `    ${l}`)
      .join("\n"),
    "    …",
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
