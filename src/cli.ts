#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { appendFileSync, writeFileSync } from "node:fs";
import { DB } from "./db.js";
import { ExclusionList } from "./exclusions.js";
import { GitHubSearchClient } from "./github-search.js";
import { runScan } from "./pipeline.js";
import { postApproved } from "./poster.js";
import type { ExclusionKind, RunMode } from "./types.js";

// ---------------------------------------------------------------------------
// Config / env
// ---------------------------------------------------------------------------

function loadEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

function requireToken(): string {
  const token = process.env["GITHUB_TOKEN"];
  if (!token) {
    die("GITHUB_TOKEN not set. Copy .env.example → .env and add your PAT.");
  }
  return token;
}

function getDbPath(): string {
  return process.env["PUBLICGUARD_DB_PATH"] ?? resolve(process.cwd(), "data/publicguard.db");
}

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

loadEnv();

const [, , command, ...args] = process.argv;

switch (command) {
  case "scan":
    await cmdScan();
    break;
  case "review":
    await cmdReview();
    break;
  case "post":
    await cmdPost(args);
    break;
  case "status":
    await cmdStatus();
    break;
  case "pause":
    cmdPause();
    break;
  case "resume":
    cmdResume();
    break;
  case "mode":
    cmdMode(args[0] as RunMode | undefined);
    break;
  case "cap":
    cmdCap(args[0]);
    break;
  case "exclude":
    cmdExclude(args);
    break;
  case "run":
    await cmdRun();
    break;
  case "schedule":
    await cmdSchedule(args);
    break;
  case undefined:
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdScan(): Promise<void> {
  const token = requireToken();
  const db = new DB(getDbPath());
  const client = new GitHubSearchClient(token);

  console.log("Running scan …");
  const summary = await runScan(db, client, {
    onProgress: (msg) => console.log(msg),
  });

  console.log(`
Scan complete:
  Queries run:        ${summary.queriesRun}
  Files inspected:    ${summary.filesInspected}
  New findings:       ${summary.newFindings}
  Duplicates skipped: ${summary.skippedDuplicates}
  Excluded/ignored:   ${summary.skippedExcluded}
  ${summary.rateLimitHit ? "Warning: rate limit hit — run again later" : ""}
  `);
  db.close();
}

async function cmdReview(): Promise<void> {
  const db = new DB(getDbPath());
  const pending = db.getByStatus("pending");

  if (pending.length === 0) {
    console.log("No pending findings. Run: publicguard scan");
    db.close();
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  console.log(`\n${pending.length} pending finding(s) to review.\n`);

  for (const finding of pending) {
    console.log(`\n─────────────────────────────────────────`);
    console.log(`Repo:     ${finding.repo}`);
    console.log(`File:     ${finding.filePath}`);
    console.log(`Detector: ${finding.detectorLabel}`);
    console.log(`Commit:   ${finding.commitSha.slice(0, 7)}`);
    if (finding.lineNumber) console.log(`Line:     ${finding.lineNumber}`);
    console.log(`Found:    ${finding.foundAt}`);

    const answer = await ask("\n[a]pprove / [s]kip / [q]uit? ");
    const choice = answer.trim().toLowerCase();

    if (choice === "a") {
      db.updateStatus(finding.id, "approved");
      console.log("Approved.");
    } else if (choice === "s") {
      db.updateStatus(finding.id, "skipped");
      console.log("Skipped.");
    } else if (choice === "q") {
      console.log("Quitting review.");
      break;
    } else {
      console.log("Invalid input — skipping.");
    }
  }

  rl.close();
  db.close();
}

async function cmdPost(flags: string[]): Promise<void> {
  const token = requireToken();
  const db = new DB(getDbPath());
  const client = new GitHubSearchClient(token);
  const dryRun = flags.includes("--dry-run") || flags.includes("-n");

  if (dryRun) console.log("DRY RUN — nothing will be posted.\n");

  const summary = await postApproved(db, client, {
    dryRun,
    onProgress: (msg) => console.log(msg),
  });

  console.log(`\nPost complete:
  Attempted: ${summary.attempted}
  Posted:    ${summary.posted}
  Skipped:   ${summary.skipped}
  ${summary.blocked ? `Blocked:   ${summary.blocked}` : ""}
  `);
  db.close();
}

function cmdStatus(): void {
  const db = new DB(getDbPath());
  const s = db.stats();
  const daily = db.dailyStats(7);
  const mode = db.getMode();
  const paused = db.isPaused() || !!process.env["PUBLICGUARD_PAUSE"];
  const cap = db.getDailyCap();
  const today = db.todayPostCount();

  console.log(`\nPublicGuard status
  Mode:        ${mode}${paused ? " [PAUSED]" : ""}
  Daily cap:   ${today}/${cap} used today

Queue:
  Pending:     ${s.pending}
  Approved:    ${s.approved}
  Skipped:     ${s.skipped}
  Posted:      ${s.posted}
  Paused:      ${s.paused}
  Total:       ${s.total}

Recent posting activity:`);

  if (daily.length === 0) {
    console.log("  (none yet)");
  } else {
    for (const d of daily) {
      console.log(`  ${d.date}  ${d.posts} post(s)`);
    }
  }
  console.log();
  db.close();
}

function cmdPause(): void {
  const db = new DB(getDbPath());
  db.setPaused(true);
  console.log("Kill switch activated. All posting halted. Run: publicguard resume");
  db.close();
}

function cmdResume(): void {
  const db = new DB(getDbPath());
  if (process.env["PUBLICGUARD_PAUSE"]) {
    console.error("PUBLICGUARD_PAUSE env var is set — unset it first.");
    db.close();
    return;
  }
  db.setPaused(false);
  console.log("Kill switch cleared. Posting re-enabled.");
  db.close();
}

function cmdMode(mode: RunMode | undefined): void {
  const validModes: RunMode[] = ["shadow", "capped", "auto"];
  if (!mode) {
    const db = new DB(getDbPath());
    console.log(`Current mode: ${db.getMode()}`);
    console.log("Valid modes: shadow | capped | auto");
    db.close();
    return;
  }
  if (!validModes.includes(mode)) {
    die(`Invalid mode '${mode}'. Valid: shadow | capped | auto`);
  }
  const db = new DB(getDbPath());
  db.setMode(mode);
  console.log(`Mode set to: ${mode}`);
  if (mode !== "shadow") {
    console.log(
      "Remember: run 'publicguard post --dry-run' first to preview what would be posted.",
    );
  }
  db.close();
}

function cmdCap(capStr: string | undefined): void {
  if (!capStr) {
    const db = new DB(getDbPath());
    console.log(`Daily cap: ${db.getDailyCap()} issues/day`);
    db.close();
    return;
  }
  const cap = parseInt(capStr, 10);
  if (Number.isNaN(cap) || cap < 1) {
    die("Cap must be a positive integer.");
  }
  const db = new DB(getDbPath());
  db.setDailyCap(cap);
  console.log(`Daily cap set to ${cap} issue(s)/day.`);
  db.close();
}

async function cmdRun(): Promise<void> {
  const token = requireToken();
  const db = new DB(getDbPath());
  const client = new GitHubSearchClient(token);
  const mode = db.getMode();
  const ts = new Date().toISOString();

  console.log(`[${ts}] publicguard run — mode: ${mode}`);

  // --- Scan ---
  const scanSummary = await runScan(db, client, {
    onProgress: (msg) => console.log(msg),
  });
  console.log(
    `Scan: ${scanSummary.newFindings} new, ${scanSummary.skippedDuplicates} dup, ${scanSummary.skippedExcluded} excluded`,
  );

  if (mode === "shadow") {
    console.log("Shadow mode — findings queued, nothing posted. Run: publicguard mode capped");
    db.close();
    return;
  }

  // --- Auto-approve ---
  const approved = db.autoApprove();
  if (approved > 0) console.log(`Auto-approved ${approved} finding(s)`);

  // --- Post ---
  const postSummary = await postApproved(db, client, {
    onProgress: (msg) => console.log(msg),
  });
  console.log(
    `Post: ${postSummary.posted} posted, ${postSummary.skipped} skipped${postSummary.blocked ? ` — ${postSummary.blocked}` : ""}`,
  );

  db.close();
}

async function cmdSchedule(args: string[]): Promise<void> {
  const interval = args[0] ?? "6h";
  const validIntervals: Record<string, string> = {
    "1h":    "0 * * * *",
    "3h":    "0 */3 * * *",
    "6h":    "0 */6 * * *",
    "12h":   "0 */12 * * *",
    "daily": "0 8 * * *",
  };

  const cronExpr = validIntervals[interval];
  if (!cronExpr) {
    die(`Unknown interval '${interval}'. Valid: ${Object.keys(validIntervals).join(" | ")}`);
  }

  const projectDir = resolve(process.cwd());
  const nodeExe = process.execPath;
  const cliPath = resolve(projectDir, "dist/cli.js");
  const envPath = resolve(projectDir, ".env");
  const logPath = resolve(projectDir, "data/publicguard.log");
  const wrapperPath = resolve(projectDir, "scripts/run-cron.sh");

  // Write a wrapper script that loads .env before calling the CLI.
  // Cron environments have no PATH or shell config, so everything is absolute.
  const wrapperContent = `#!/usr/bin/env bash
# Auto-generated by: publicguard schedule
# Do not edit — re-run 'publicguard schedule' to regenerate.
set -euo pipefail
if [[ -f "${envPath}" ]]; then
  set -o allexport
  source "${envPath}"
  set +o allexport
fi
exec "${nodeExe}" "${cliPath}" run
`;
  writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });
  console.log(`Wrote ${wrapperPath}`);

  // Install crontab entry idempotently.
  const marker = "# publicguard";
  const cronLine = `${cronExpr} "${wrapperPath}" >> "${logPath}" 2>&1 ${marker}`;

  const { execSync } = await import("node:child_process");

  let existing = "";
  try {
    existing = execSync("crontab -l 2>/dev/null", { encoding: "utf8" });
  } catch {
    // No existing crontab — start fresh.
  }

  const filtered = existing
    .split("\n")
    .filter((l) => !l.includes(marker))
    .join("\n")
    .trimEnd();

  const newCrontab = (filtered ? `${filtered}\n` : "") + `${cronLine}\n`;
  const tmpPath = `/tmp/publicguard-crontab-${Date.now()}`;
  writeFileSync(tmpPath, newCrontab);
  execSync(`crontab "${tmpPath}"`);

  console.log(`Cron installed (${interval}): ${cronExpr}`);
  console.log(`Log: ${logPath}`);
  console.log(`\nVerify with: crontab -l | grep publicguard`);
}

function cmdExclude(args: string[]): void {
  const sub = args[0];
  const db = new DB(getDbPath());
  const excl = new ExclusionList(db);

  if (!sub || sub === "list") {
    const list = excl.list();
    if (list.length === 0) {
      console.log("No exclusions.");
    } else {
      console.log("Exclusions:");
      for (const e of list) {
        const note = e.note ? ` — ${e.note}` : "";
        console.log(`  [${e.id}] ${e.kind}:${e.value}${note}`);
      }
    }
    db.close();
    return;
  }

  if (sub === "add") {
    const target = args[1];
    if (!target) die("Usage: publicguard exclude add owner/repo  OR  exclude add @owner");
    let kind: ExclusionKind;
    let value: string;
    if (target.startsWith("@")) {
      kind = "owner";
      value = target.slice(1);
    } else if (target.includes("/")) {
      kind = "repo";
      value = target;
    } else {
      die(`Unrecognised format '${target}'. Use owner/repo or @owner.`);
    }
    const note = args.slice(2).join(" ") || null;
    excl.add(kind, value, note ?? undefined);
    console.log(`Excluded: ${kind} ${value}`);
    db.close();
    return;
  }

  if (sub === "remove") {
    const id = parseInt(args[1] ?? "", 10);
    if (Number.isNaN(id)) die("Usage: publicguard exclude remove <id>");
    excl.remove(id);
    console.log(`Removed exclusion #${id}`);
    db.close();
    return;
  }

  die(`Unknown subcommand '${sub}'. Try: exclude list | exclude add | exclude remove`);
}

function printHelp(): void {
  console.log(`
publicguard — good-faith secret-leak notifier for public GitHub repos

Usage:
  publicguard run               Scan + auto-approve + post in one step (use this for cron)
  publicguard schedule [interval]  Install cron job for 'run' (default: 6h; options: 1h 3h 6h 12h daily)
  publicguard scan              Scan only — adds findings to queue, does not post
  publicguard post [--dry-run]  Post approved findings (respects guardrails)
  publicguard status            Show queue stats and recent posting activity
  publicguard pause             Activate kill switch — halt all activity immediately
  publicguard resume            Clear kill switch
  publicguard mode [shadow|capped|auto]  Get or set run mode
  publicguard cap [N]           Get or set daily posting cap
  publicguard exclude list      Show excluded repos and owners
  publicguard exclude add <owner/repo|@owner> [note]  Add exclusion
  publicguard exclude remove <id>  Remove exclusion by ID
  publicguard review            Interactively review pending findings (manual alternative to auto-approve)

Opt-out (.publicguard-ignore):
  A repo owner can add a .publicguard-ignore file anywhere in their repo.
  The scanner detects it and skips the repo permanently.

Env vars:
  GITHUB_TOKEN          GitHub PAT with public_repo scope  (required for scan/post)
  PUBLICGUARD_DB_PATH   Path to SQLite database  (default: ./data/publicguard.db)
  PUBLICGUARD_PAUSE     Set to any value to activate kill switch
`);
}
