import type { DB } from "./db.js";

export interface GuardrailCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * All checks that must pass before a single issue post is allowed.
 * Called at the start of every post attempt — applies even at full autonomy.
 */
export function checkGuardrails(db: DB): GuardrailCheck {
  // Kill switch: env var takes priority, then DB flag
  if (process.env["PUBLICGUARD_PAUSE"]) {
    return { allowed: false, reason: "Kill switch active (PUBLICGUARD_PAUSE env var set)" };
  }

  if (db.isPaused()) {
    return { allowed: false, reason: "Kill switch active (run: publicguard resume)" };
  }

  const mode = db.getMode();
  if (mode === "shadow") {
    return { allowed: false, reason: "Shadow mode — posting disabled. Run: publicguard mode capped" };
  }

  const cap = db.getDailyCap();
  const todayCount = db.todayPostCount();
  if (todayCount >= cap) {
    return {
      allowed: false,
      reason: `Daily cap reached (${todayCount}/${cap} posts today). Resets at midnight UTC.`,
    };
  }

  return { allowed: true };
}

/**
 * Call this when a negative signal is detected on a posted issue
 * (spam flag, hostile reply, unsubscribe-style response).
 * Pauses all further posting and flags the finding for manual review.
 */
export function triggerAutoPause(db: DB, findingId: number, reason: string): void {
  db.setPaused(true);
  db.updateStatus(findingId, "paused");
  console.error(
    `\n[publicguard] AUTO-PAUSE triggered for finding #${findingId}: ${reason}\n` +
      "Posting halted. Review the finding and run: publicguard resume\n",
  );
}
