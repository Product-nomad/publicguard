import { detectSecrets } from "./detect.js";
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
];

function isFalsePositiveRepo(repoName: string): boolean {
  const lower = repoName.toLowerCase();
  return FP_REPO_NAME_FRAGMENTS.some((f) => lower.includes(f));
}

export interface ScanOptions {
  /** Results to fetch per seed query. Default 10. Max 30. */
  perQuery?: number;
  /** Override the seed query list (useful for testing). */
  queries?: SeedQuery[];
  onProgress?: (msg: string) => void;
}

export interface ScanSummary {
  queriesRun: number;
  filesInspected: number;
  newFindings: number;
  skippedDuplicates: number;
  skippedExcluded: number;
  rateLimitHit: boolean;
}

export async function runScan(
  db: DB,
  client: GitHubSearchClient,
  opts: ScanOptions = {},
): Promise<ScanSummary> {
  const queries = opts.queries ?? SEED_QUERIES;
  const perQuery = Math.min(opts.perQuery ?? 10, 30);
  const log = opts.onProgress ?? (() => undefined);
  const exclusions = new ExclusionList(db);

  const summary: ScanSummary = {
    queriesRun: 0,
    filesInspected: 0,
    newFindings: 0,
    skippedDuplicates: 0,
    skippedExcluded: 0,
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
        log(`Rate limit hit — stopping scan early.`);
        summary.rateLimitHit = true;
        break;
      }
      log(`Search error (${query.id}): ${String(err)}`);
      continue;
    }
    summary.queriesRun++;
    log(`  Found ${results.length} file(s) to inspect`);

    for (const result of results) {
      // DB exclusion check — before any API call to the repo.
      if (exclusions.isExcluded(result.repoOwner, result.repoName)) {
        log(`  [EXCLUDED] ${result.repo}`);
        summary.skippedExcluded++;
        continue;
      }

      // Repo-name FP filter — catches honeypot/example/demo repos where
      // committed secrets are intentional, not accidental.
      if (isFalsePositiveRepo(result.repoName)) {
        log(`  [FP-REPO] ${result.repo} (repo name suggests non-production)`);
        summary.skippedExcluded++;
        continue;
      }

      summary.filesInspected++;

      // .publicguard-ignore file check — one HEAD request, cached per repo.
      const ignored = await client.fileExists(
        result.repoOwner,
        result.repoName,
        ".publicguard-ignore",
      );
      if (ignored) {
        log(`  [IGNORED] ${result.repo} (.publicguard-ignore present)`);
        summary.skippedExcluded++;
        // Auto-add to DB so we don't check again next run.
        exclusions.add("repo", result.repo, "auto: .publicguard-ignore file detected");
        continue;
      }

      const content = await client.fetchFileContent(
        result.repoOwner,
        result.repoName,
        result.filePath,
        result.commitSha,
      );

      if (!content) continue;

      const hits = detectSecrets(content, result.filePath);
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
          log(
            `  [NEW] ${result.repo} ${result.filePath} — ${hit.label} (preview: ${hit.preview})`,
          );
        } else {
          summary.skippedDuplicates++;
        }
      }

      await sleep(500);
    }

    await sleep(2000);
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
