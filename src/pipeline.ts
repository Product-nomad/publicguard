import { detectSecrets, isFalsePositivePath } from "./detect.js";
import type { DB } from "./db.js";
import { ExclusionList } from "./exclusions.js";
import { GitHubSearchClient } from "./github-search.js";
import { SEED_QUERIES } from "./seeds.js";
import type { SeedQuery } from "./types.js";

function isKillSwitchActive(db: DB): boolean {
  return !!process.env["PUBLICGUARD_PAUSE"] || db.isPaused();
}

const FP_REPO_NAME_FRAGMENTS = [
  "example",
  "demo",
  "tutorial",
  "sample",
  "test",
  "honeypot",
  "fake",
  "dummy",
  "placeholder",
  "boilerplate",
  "template",
  "starter",
  "scaffold",
  "learn",
  "course",
  "practice",
  "exercise",
  "workshop",
  "playground",
  "ctf",
  "tryhackme",
  "hackthebox",
  "offsec",
  "pentest",
  "wargame",
  "challenge",
];

function isFalsePositiveRepo(repoName: string): boolean {
  const lower = repoName.toLowerCase();
  return FP_REPO_NAME_FRAGMENTS.some((f) => lower.includes(f));
}

export interface ScanOptions {
  perQuery?: number;
  queries?: SeedQuery[];
  verbose?: boolean;
  onProgress?: (msg: string) => void;
}

export interface ScanSummary {
  queriesRun: number;
  filesSearched: number;
  filesInspected: number;
  newFindings: number;
  skippedDuplicates: number;
  // Suppression breakdown — for tuning
  suppressedByRepo: number;
  suppressedByPath: number;
  suppressedNoContent: number;
  suppressedNoHits: number;
  suppressedExcluded: number;
  rateLimitHit: boolean;
}

export async function runScan(
  db: DB,
  client: GitHubSearchClient,
  opts: ScanOptions = {},
): Promise<ScanSummary> {
  const queries = opts.queries ?? SEED_QUERIES;
  const perQuery = Math.min(opts.perQuery ?? 10, 30);
  const verbose = opts.verbose ?? false;
  const log = opts.onProgress ?? (() => undefined);
  const vlog = verbose ? log : () => undefined;
  const exclusions = new ExclusionList(db);

  const summary: ScanSummary = {
    queriesRun: 0,
    filesSearched: 0,
    filesInspected: 0,
    newFindings: 0,
    skippedDuplicates: 0,
    suppressedByRepo: 0,
    suppressedByPath: 0,
    suppressedNoContent: 0,
    suppressedNoHits: 0,
    suppressedExcluded: 0,
    rateLimitHit: false,
  };

  if (isKillSwitchActive(db)) {
    log("Kill switch active — scan aborted.");
    return summary;
  }

  for (const query of queries) {
    if (isKillSwitchActive(db)) {
      log("Kill switch activated mid-scan — stopping.");
      break;
    }
    log(`Searching: ${query.label} …`);
    let results;
    try {
      results = await client.searchCode(query, perQuery);
    } catch (err) {
      if (isRateLimitError(err)) {
        const rl = err as { resetAt: Date | null; retryAfterSeconds: number | null };
        const waitMs = rl.retryAfterSeconds
          ? rl.retryAfterSeconds * 1000
          : rl.resetAt
            ? Math.max(0, rl.resetAt.getTime() - Date.now()) + 2000
            : 65000; // default: wait 65s and retry once
        log(`Rate limit hit — waiting ${Math.round(waitMs / 1000)}s then retrying …`);
        await sleep(waitMs);
        try {
          results = await client.searchCode(query, perQuery);
        } catch {
          log(`Rate limit persists after wait — stopping scan early.`);
          summary.rateLimitHit = true;
          break;
        }
      } else {
        log(`Search error (${query.id}): ${String(err)}`);
        continue;
      }
    }
    summary.queriesRun++;
    summary.filesSearched += results.length;
    log(`  ${results.length} result(s)`);

    for (const result of results) {
      if (exclusions.isExcluded(result.repoOwner, result.repoName)) {
        vlog(`  [excluded]   ${result.repo}/${result.filePath}`);
        summary.suppressedExcluded++;
        continue;
      }

      if (isFalsePositiveRepo(result.repoName)) {
        vlog(`  [fp-repo]    ${result.repo} (repo name: ${result.repoName})`);
        summary.suppressedByRepo++;
        continue;
      }

      if (isFalsePositivePath(result.filePath)) {
        vlog(`  [fp-path]    ${result.repo}/${result.filePath}`);
        summary.suppressedByPath++;
        continue;
      }

      summary.filesInspected++;

      const ignored = await client.fileExists(
        result.repoOwner,
        result.repoName,
        ".publicguard-ignore",
      );
      if (ignored) {
        log(`  [ignored]    ${result.repo} (.publicguard-ignore)`);
        summary.suppressedExcluded++;
        exclusions.add("repo", result.repo, "auto: .publicguard-ignore detected");
        continue;
      }

      const content = await client.fetchFileContent(
        result.repoOwner,
        result.repoName,
        result.filePath,
        result.commitSha,
      );

      if (!content) {
        vlog(`  [no-content] ${result.repo}/${result.filePath} (deleted or inaccessible)`);
        summary.suppressedNoContent++;
        continue;
      }

      const hits = detectSecrets(content, result.filePath);

      if (hits.length === 0) {
        vlog(`  [no-hits]    ${result.repo}/${result.filePath}`);
        summary.suppressedNoHits++;
        continue;
      }

      for (const hit of hits) {
        const id = db.insertFinding({
          repo: result.repo,
          repoOwner: result.repoOwner,
          repoName: result.repoName,
          filePath: result.filePath,
          commitSha: result.commitSha,
          detectorId: hit.patternId,
          detectorLabel: hit.label,
          lineNumber: hit.lineNumber,
          foundAt: new Date().toISOString(),
        });
        if (id !== null) {
          summary.newFindings++;
          log(`  [NEW]        ${result.repo}/${result.filePath} — ${hit.label}`);
        } else {
          summary.skippedDuplicates++;
          vlog(`  [dup]        ${result.repo}/${result.filePath} — ${hit.label}`);
        }
      }

      await sleep(500);
    }

    // GitHub Code Search rate limit: 10 req/min authenticated = 1 per 6s.
    // 8s gives a 25% margin; file-content fetches use the separate REST budget.
    await sleep(8000);
  }

  return summary;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: string }).name === "RateLimitError"
  );
}
