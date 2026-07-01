import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DailyStats, FindingStatus, QueuedFinding, RunMode } from "./types.js";

export class DB {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS findings (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        repo         TEXT NOT NULL,
        repo_owner   TEXT NOT NULL,
        repo_name    TEXT NOT NULL,
        file_path    TEXT NOT NULL,
        commit_sha   TEXT NOT NULL,
        detector_id  TEXT NOT NULL,
        detector_label TEXT NOT NULL,
        line_number  INTEGER,
        found_at     TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        issue_url    TEXT,
        issue_number INTEGER,
        posted_at    TEXT,
        UNIQUE(repo, file_path, commit_sha, detector_id)
      );

      CREATE TABLE IF NOT EXISTS daily_log (
        date  TEXT PRIMARY KEY,
        posts INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.db.prepare(`
      INSERT OR IGNORE INTO config (key, value) VALUES ('mode', 'shadow')
    `).run();

    this.db.prepare(`
      INSERT OR IGNORE INTO config (key, value) VALUES ('daily_cap', '10')
    `).run();

    this.db.prepare(`
      INSERT OR IGNORE INTO config (key, value) VALUES ('paused', '0')
    `).run();
  }

  insertFinding(finding: Omit<QueuedFinding, "id" | "status" | "issueUrl" | "issueNumber" | "postedAt">): number | null {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO findings
        (repo, repo_owner, repo_name, file_path, commit_sha,
         detector_id, detector_label, line_number, found_at)
      VALUES
        (@repo, @repoOwner, @repoName, @filePath, @commitSha,
         @detectorId, @detectorLabel, @lineNumber, @foundAt)
    `);
    const result = stmt.run({
      repo: finding.repo,
      repoOwner: finding.repoOwner,
      repoName: finding.repoName,
      filePath: finding.filePath,
      commitSha: finding.commitSha,
      detectorId: finding.detectorId,
      detectorLabel: finding.detectorLabel,
      lineNumber: finding.lineNumber ?? null,
      foundAt: finding.foundAt,
    });
    return result.changes > 0 ? Number(result.lastInsertRowid) : null;
  }

  getByStatus(status: FindingStatus): QueuedFinding[] {
    return this.db
      .prepare("SELECT * FROM findings WHERE status = ? ORDER BY found_at ASC")
      .all(status) as QueuedFinding[];
  }

  getById(id: number): QueuedFinding | null {
    return (
      (this.db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as QueuedFinding | undefined) ?? null
    );
  }

  updateStatus(id: number, status: FindingStatus): void {
    this.db
      .prepare("UPDATE findings SET status = ? WHERE id = ?")
      .run(status, id);
  }

  markPosted(id: number, issueUrl: string, issueNumber: number): void {
    this.db.prepare(`
      UPDATE findings
      SET status = 'posted', issue_url = ?, issue_number = ?, posted_at = ?
      WHERE id = ?
    `).run(issueUrl, issueNumber, new Date().toISOString(), id);
  }

  stats(): {
    pending: number;
    approved: number;
    skipped: number;
    posted: number;
    paused: number;
    total: number;
  } {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'skipped'  THEN 1 ELSE 0 END) as skipped,
        SUM(CASE WHEN status = 'posted'   THEN 1 ELSE 0 END) as posted,
        SUM(CASE WHEN status = 'paused'   THEN 1 ELSE 0 END) as paused,
        COUNT(*) as total
      FROM findings
    `).get() as Record<string, number | null>;

    return {
      pending: Number(row["pending"] ?? 0),
      approved: Number(row["approved"] ?? 0),
      skipped: Number(row["skipped"] ?? 0),
      posted: Number(row["posted"] ?? 0),
      paused: Number(row["paused"] ?? 0),
      total: Number(row["total"] ?? 0),
    };
  }

  todayPostCount(): number {
    const today = todayDate();
    const row = this.db
      .prepare("SELECT posts FROM daily_log WHERE date = ?")
      .get(today) as { posts: number } | undefined;
    return row?.posts ?? 0;
  }

  incrementPostCount(): void {
    const today = todayDate();
    this.db.prepare(`
      INSERT INTO daily_log (date, posts) VALUES (?, 1)
      ON CONFLICT(date) DO UPDATE SET posts = posts + 1
    `).run(today);
  }

  dailyStats(days = 7): DailyStats[] {
    return this.db
      .prepare(
        "SELECT date, posts FROM daily_log ORDER BY date DESC LIMIT ?",
      )
      .all(days) as DailyStats[];
  }

  getConfig(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  getMode(): RunMode {
    return (this.getConfig("mode") ?? "shadow") as RunMode;
  }

  setMode(mode: RunMode): void {
    this.setConfig("mode", mode);
  }

  isPaused(): boolean {
    return this.getConfig("paused") === "1";
  }

  setPaused(paused: boolean): void {
    this.setConfig("paused", paused ? "1" : "0");
  }

  getDailyCap(): number {
    return parseInt(this.getConfig("daily_cap") ?? "10", 10);
  }

  setDailyCap(cap: number): void {
    this.setConfig("daily_cap", String(cap));
  }

  close(): void {
    this.db.close();
  }
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}
