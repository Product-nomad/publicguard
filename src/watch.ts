import type { DB } from "./db.js";
import { triggerAutoPause } from "./guardrails.js";
import type { GitHubSearchClient } from "./github-search.js";
import type { QueuedFinding } from "./types.js";

export interface WatchOptions {
  onProgress?: (msg: string) => void;
}

export interface WatchSummary {
  issuesChecked: number;
  newReplies: number;
}

/**
 * Poll previously-posted issues for new replies. PublicGuard never comments
 * after opening an issue, so any increase in comment count means someone
 * external responded — most often a repo owner disputing a finding, as in
 * the Firebase-key false positive that prompted this. Any new reply pauses
 * further posting (via the kill switch) until a human reviews it; false
 * negatives here (pausing on a "thanks, fixed!" reply) are far cheaper than
 * the false negative of silently continuing to spam after a dispute.
 */
export async function checkPostedIssuesForReplies(
  db: DB,
  client: GitHubSearchClient,
  opts: WatchOptions = {},
): Promise<WatchSummary> {
  const log = opts.onProgress ?? (() => undefined);
  const summary: WatchSummary = { issuesChecked: 0, newReplies: 0 };

  const posted = db.getByStatus("posted");
  const byIssue = new Map<string, QueuedFinding[]>();
  for (const f of posted) {
    if (f.issueNumber == null) continue;
    const key = `${f.repo}::${f.issueNumber}`;
    const group = byIssue.get(key) ?? [];
    group.push(f);
    byIssue.set(key, group);
  }

  for (const group of byIssue.values()) {
    const first = group[0];
    if (!first || first.issueNumber == null) continue;
    summary.issuesChecked++;

    const commentCount = await client.getIssueCommentCount(
      first.repoOwner,
      first.repoName,
      first.issueNumber,
    );
    const seen = Math.max(...group.map((f) => f.lastCommentCount));

    if (commentCount > seen) {
      summary.newReplies++;
      log(`  New reply on ${first.repo}#${first.issueNumber} — pausing for review`);
      for (const f of group) db.setLastCommentCount(f.id, commentCount);
      triggerAutoPause(
        db,
        first.id,
        `New reply on ${first.repo}#${first.issueNumber} — review before resuming`,
      );
    } else if (commentCount !== seen) {
      for (const f of group) db.setLastCommentCount(f.id, commentCount);
    }
  }

  return summary;
}
