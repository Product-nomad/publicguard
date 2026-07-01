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
 * Post approved findings as GitHub Issues.
 * Respects all runtime guardrails — safe to call even from a cron job.
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

  for (const finding of approved) {
    const guard = checkGuardrails(db);
    if (!guard.allowed) {
      summary.blocked = guard.reason ?? "Guardrail blocked posting";
      log(`Posting blocked: ${summary.blocked}`);
      break;
    }

    summary.attempted++;
    if (opts.dryRun) {
      log(formatDryRun(finding));
      summary.skipped++;
      continue;
    }

    try {
      const title = renderIssueTitle(finding);
      const body = renderIssueBody(finding);
      const result = await client.createIssue(
        finding.repoOwner,
        finding.repoName,
        title,
        body,
      );
      db.markPosted(finding.id, result.url, result.number);
      db.incrementPostCount();
      summary.posted++;
      log(`  Posted: ${result.url}`);
      await sleep(3000);
    } catch (err) {
      log(`  Error posting to ${finding.repo}: ${String(err)}`);
      summary.skipped++;
    }
  }

  return summary;
}

function formatDryRun(finding: QueuedFinding): string {
  return [
    `[DRY RUN] Would post to: ${finding.repo}`,
    `  File:     ${finding.filePath}`,
    `  Detector: ${finding.detectorLabel}`,
    `  Commit:   ${finding.commitSha.slice(0, 7)}`,
    `  Title:    ${renderIssueTitle(finding)}`,
    `  Body:\n${renderIssueBody(finding)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n")}`,
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
