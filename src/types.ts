export type FindingStatus =
  | "pending"
  | "approved"
  | "skipped"
  | "posted"
  | "paused";

export type RunMode = "shadow" | "capped" | "auto";

export interface QueuedFinding {
  id: number;
  repo: string;
  repoOwner: string;
  repoName: string;
  filePath: string;
  commitSha: string;
  detectorId: string;
  detectorLabel: string;
  lineNumber: number | null;
  preview: string | null;
  foundAt: string;
  status: FindingStatus;
  issueUrl: string | null;
  issueNumber: number | null;
  postedAt: string | null;
  lastCommentCount: number;
}

export interface SearchResult {
  repo: string;
  repoOwner: string;
  repoName: string;
  filePath: string;
  commitSha: string;
  fileUrl: string;
  rawContent: string;
}

export interface SeedQuery {
  id: string;
  label: string;
  q: string;
}

export interface DailyStats {
  date: string;
  posts: number;
}

export interface PostResult {
  issueUrl: string;
  issueNumber: number;
}

export type ExclusionKind = "repo" | "owner";

export interface Exclusion {
  id: number;
  kind: ExclusionKind;
  value: string;
  addedAt: string;
  note: string | null;
}
