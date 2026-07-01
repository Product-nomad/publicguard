import type { DB } from "./db.js";

/**
 * Exclusions are stored in the DB and checked before any finding is queued
 * or any API call is made to a repo. Two types:
 *   - repo:  "owner/repo"  — excludes one specific repo
 *   - owner: "@owner"      — excludes all repos under an account
 *
 * A third signal is also checked at file-fetch time: a .publicguard-ignore
 * file anywhere in the target repo. That check is in pipeline.ts since it
 * requires a live API call.
 */

export type ExclusionKind = "repo" | "owner";

export interface Exclusion {
  id: number;
  kind: ExclusionKind;
  value: string;
  addedAt: string;
  note: string | null;
}

export class ExclusionList {
  private readonly db: DB;

  constructor(db: DB) {
    this.db = db;
    this.db.ensureExclusionsTable();
  }

  add(kind: ExclusionKind, value: string, note?: string): void {
    this.db.insertExclusion(kind, value, note ?? null);
  }

  isExcluded(repoOwner: string, repoName: string): boolean {
    const repo = `${repoOwner}/${repoName}`;
    return (
      this.db.hasExclusion("repo", repo) ||
      this.db.hasExclusion("owner", repoOwner)
    );
  }

  list(): Exclusion[] {
    return this.db.getExclusions();
  }

  remove(id: number): void {
    this.db.removeExclusion(id);
  }
}
