import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { DB } from "./db.js";

const baseFinding = {
  repo: "acme/widgets",
  repoOwner: "acme",
  repoName: "widgets",
  filePath: ".env",
  commitSha: "a".repeat(40),
  foundAt: new Date().toISOString(),
};

describe("DB findings", () => {
  it("keeps two distinct secrets of the same detector in the same file+commit", () => {
    const db = new DB(":memory:");
    const first = db.insertFinding({
      ...baseFinding,
      detectorId: "aws-access-key",
      detectorLabel: "AWS Access Key ID",
      lineNumber: 1,
      matchIndex: 10,
      preview: "AKIA…AAAA",
      valueHash: "hash-a",
    });
    const second = db.insertFinding({
      ...baseFinding,
      detectorId: "aws-access-key",
      detectorLabel: "AWS Access Key ID",
      lineNumber: 2,
      matchIndex: 80,
      preview: "AKIA…BBBB",
      valueHash: "hash-b",
    });
    assert.ok(first !== null, "first distinct secret must be inserted");
    assert.ok(second !== null, "second distinct secret at a different location must not collide");
    assert.notEqual(first, second);
    db.close();
  });

  it("still dedupes a byte-identical re-scan of the same match", () => {
    const db = new DB(":memory:");
    const first = db.insertFinding({
      ...baseFinding,
      detectorId: "aws-access-key",
      detectorLabel: "AWS Access Key ID",
      lineNumber: 1,
      matchIndex: 10,
      preview: "AKIA…AAAA",
      valueHash: "hash-a",
    });
    const rescan = db.insertFinding({
      ...baseFinding,
      detectorId: "aws-access-key",
      detectorLabel: "AWS Access Key ID",
      lineNumber: 1,
      matchIndex: 10,
      preview: "AKIA…AAAA",
      valueHash: "hash-a",
    });
    assert.ok(first !== null);
    assert.equal(rescan, null, "identical re-scan of the same location must be a no-op");
    db.close();
  });

  it("autoApprove only bulk-approves high-confidence detectors", () => {
    const db = new DB(":memory:");
    db.insertFinding({
      ...baseFinding,
      detectorId: "aws-access-key",
      detectorLabel: "AWS Access Key ID",
      lineNumber: 1,
      matchIndex: 0,
      preview: "AKIA…AAAA",
      valueHash: "hash-a",
    });
    db.insertFinding({
      ...baseFinding,
      detectorId: "google-api-key",
      detectorLabel: "Google API key",
      lineNumber: 2,
      matchIndex: 50,
      preview: "AIza…ZZZZ",
      valueHash: "hash-b",
    });

    const approvedCount = db.autoApprove();
    assert.equal(approvedCount, 1);
    assert.deepEqual(
      db.getByStatus("pending").map((f) => f.detectorId),
      ["google-api-key"],
    );
    assert.deepEqual(
      db.getByStatus("approved").map((f) => f.detectorId),
      ["aws-access-key"],
    );
    db.close();
  });

  it("hasValueHashForRepo finds the same secret across different files", () => {
    const db = new DB(":memory:");
    db.insertFinding({
      ...baseFinding,
      filePath: "config/a.env",
      detectorId: "aws-access-key",
      detectorLabel: "AWS Access Key ID",
      lineNumber: 1,
      matchIndex: 0,
      preview: "AKIA…AAAA",
      valueHash: "shared-hash",
    });
    assert.ok(db.hasValueHashForRepo("acme/widgets", "shared-hash"));
    assert.ok(!db.hasValueHashForRepo("acme/widgets", "unrelated-hash"));
    assert.ok(!db.hasValueHashForRepo("other/repo", "shared-hash"));
    db.close();
  });

  it("upgrades an old-schema database without losing rows, and enforces the new constraint", () => {
    // Simulate a database created before match_index/value_hash existed.
    // Uses a temp file (not :memory:) since the upgrade path requires
    // closing this seed connection and reopening via DB's constructor.
    const path = `/tmp/claude-0/-root/2ed25b65-2c31-4db6-a7e5-3e171df1b7b6/scratchpad/db-migrate-test-${Date.now()}.db`;
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE findings (
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
    `);
    seed.prepare(`
      INSERT INTO findings (repo, repo_owner, repo_name, file_path, commit_sha, detector_id, detector_label, line_number, found_at, status)
      VALUES ('acme/widgets', 'acme', 'widgets', '.env', ?, 'aws-access-key', 'AWS Access Key ID', 1, ?, 'pending')
    `).run(baseFinding.commitSha, baseFinding.foundAt);
    seed.close();

    const db = new DB(path);
    const existing = db.getByStatus("pending");
    assert.equal(existing.length, 1, "pre-existing row must survive the migration");
    assert.equal(existing[0]?.detectorId, "aws-access-key");

    // New constraint must now allow a second distinct secret at a different
    // match_index in the same file+commit+detector.
    const second = db.insertFinding({
      ...baseFinding,
      detectorId: "aws-access-key",
      detectorLabel: "AWS Access Key ID",
      lineNumber: 5,
      matchIndex: 999,
      preview: "AKIA…CCCC",
      valueHash: "hash-c",
    });
    assert.ok(second !== null, "post-migration schema must not collapse distinct secrets");
    db.close();
  });
});
