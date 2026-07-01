import type { QueuedFinding } from "./types.js";

const GIT_HISTORY_HOWTO =
  "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository";

export function renderIssueTitle(_finding: QueuedFinding): string {
  return "Possible exposed credential in this repo";
}

export function renderIssueBody(finding: QueuedFinding): string {
  const fileRef = `\`${finding.filePath}\` (commit \`${finding.commitSha.slice(0, 7)}\`)`;
  return `Hi — while doing some public-good scanning for exposed secrets in public repos, I think I spotted a live-looking ${finding.detectorLabel} in ${fileRef}.

I haven't accessed, tested, or used it, and I'm not going to.

**What I'd suggest:**
1. Rotate/revoke this credential with the provider immediately
2. Remove it from git history (not just the latest commit — it's still in the log): [how to remove sensitive data from a repository](${GIT_HISTORY_HOWTO})
3. Move secrets to environment variables or a \`.gitignored\` file going forward

No action needed from me — feel free to close this issue once handled.

---
*Flagged by [PublicGuard](https://github.com/productnomad/publicguard), an open, non-commercial scan run as part of my security tooling work (companion to [SessionGuard](https://sessionguard.dev)). Happy to answer questions, no strings attached.*`;
}
