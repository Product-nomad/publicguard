import { createHash } from "node:crypto";

/**
 * Credential-detection patterns ported from SessionGuard / agentaudit.
 * Same regex/entropy detectors, different input source (public GitHub commits
 * instead of local AI agent transcripts). Keep both in sync.
 */

export type PatternConfidence = "high" | "low";

export interface SecretPattern {
  id: string;
  label: string;
  regex: RegExp;
  minMatchLen?: number;
  /**
   * "low" marks patterns that are structurally ambiguous — the matched
   * format has legitimate public/client-side uses (Firebase/Google web keys,
   * ID-token JWTs, config values that merely look like passwords) so a regex
   * match alone isn't strong evidence of a real leak. Low-confidence
   * findings are excluded from autoApprove() and always require a human
   * to run `publicguard review` before they can be posted.
   */
  confidence: PatternConfidence;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "aws-access-key",
    label: "AWS Access Key ID",
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    confidence: "high",
  },
  {
    id: "aws-secret-key",
    label: "AWS Secret Access Key (assignment)",
    regex:
      /\b(aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/g,
    confidence: "high",
  },
  {
    id: "rsa-ec-private-key",
    label: "RSA/EC private key",
    regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    confidence: "high",
  },
  {
    id: "ssh-private-key",
    label: "OpenSSH private key",
    regex: /-----BEGIN OPENSSH PRIVATE KEY-----/g,
    confidence: "high",
  },
  {
    id: "github-token",
    label: "GitHub personal access token",
    regex: /\bghp_[A-Za-z0-9]{36}\b/g,
    confidence: "high",
  },
  {
    id: "github-fine-grained",
    label: "GitHub fine-grained PAT",
    regex: /\bgithub_pat_[A-Za-z0-9_]{80,}\b/g,
    confidence: "high",
  },
  {
    id: "github-oauth",
    label: "GitHub OAuth token",
    regex: /\bgho_[A-Za-z0-9]{36}\b/g,
    confidence: "high",
  },
  {
    id: "slack-token",
    label: "Slack token",
    regex: /\bxox[aboprs]-[A-Za-z0-9-]{10,}\b/g,
    confidence: "high",
  },
  {
    id: "stripe-live-secret",
    label: "Stripe live secret key",
    regex: /\bsk_live_[A-Za-z0-9]{20,}\b/g,
    confidence: "high",
  },
  {
    id: "stripe-restricted",
    label: "Stripe restricted key",
    regex: /\brk_live_[A-Za-z0-9]{20,}\b/g,
    confidence: "high",
  },
  {
    id: "anthropic-key",
    label: "Anthropic API key",
    regex: /\bsk-ant-(?:api\d{2}|admin\d{2}|oat\d{2})-[A-Za-z0-9_-]{80,}\b/g,
    confidence: "high",
  },
  {
    id: "openai-key",
    label: "OpenAI API key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g,
    confidence: "high",
  },
  {
    id: "google-api-key",
    label: "Google API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    // Same format is used for Firebase/Google Maps web config keys, which are
    // meant to be public — access control is enforced server-side, not by
    // secrecy of this key. Context filtering catches the obvious cases; the
    // format is still ambiguous enough to require a human look.
    confidence: "low",
  },
  {
    id: "jwt",
    label: "JWT",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    minMatchLen: 60,
    // Plenty of JWTs seen in public repos are short-lived ID tokens or fixture
    // data, not live credentials.
    confidence: "low",
  },
  {
    id: "generic-password-assign",
    label: "password assignment",
    regex: /\b(?:password|passwd|pwd)\s*[=:]\s*["']([^"'\s]{8,})["']/gi,
    minMatchLen: 8,
    // Free-text variable name, not a fixed credential format — high FP rate
    // (docs, config schemas, placeholder-ish values that dodge the placeholder list).
    confidence: "low",
  },
];

export interface SecretHit {
  patternId: string;
  label: string;
  index: number;
  length: number;
  preview: string;
  /**
   * One-way SHA-256 hash of the raw match. Not the credential value itself
   * and not reversible — lets us recognize "this exact secret was already
   * reported elsewhere in this repo" without persisting anything that could
   * be used to reconstruct or authenticate with the credential (see
   * DECISIONS.md: "Never store the credential value").
   */
  valueHash: string;
}

export function redact(match: string): string {
  if (match.length <= 8) return "*".repeat(match.length);
  return `${match.slice(0, 4)}…${match.slice(-4)}`;
}

function hashValue(match: string): string {
  return createHash("sha256").update(match).digest("hex");
}

/**
 * Shannon entropy in bits/char. Catches degenerate, low-diversity strings
 * (repeated/near-repeated characters) that dodge the placeholder regex list.
 * It's a blunt instrument — sequential-but-diverse strings like "12345678"
 * still score near-maximal entropy — so this is a floor, not a strength
 * estimator. Good enough to filter obvious noise before a human reviews.
 */
function shannonEntropyBitsPerChar(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const MIN_PASSWORD_ENTROPY_BITS_PER_CHAR = 2.8;

/**
 * A JWT-shaped regex match (three dot-separated base64url segments) isn't
 * necessarily a real JWT — plenty of hashes/tokens happen to contain dots.
 * Decoding the payload and requiring valid JSON weeds those out. Expired
 * tokens (past `exp`) are much lower risk than live ones, so we keep them
 * but mark them for a reviewer instead of dropping the signal entirely.
 */
function decodeJwtPayload(match: string): Record<string, unknown> | null {
  const payloadSegment = match.split(".")[1];
  if (!payloadSegment) return null;
  try {
    const padded = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (padded.length % 4)) % 4;
    const json = Buffer.from(padded + "=".repeat(pad), "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isExpiredJwtPayload(payload: Record<string, unknown>): boolean {
  const exp = payload["exp"];
  return typeof exp === "number" && exp * 1000 < Date.now();
}

/**
 * Matches that look structurally valid but are clearly demo/placeholder values.
 * Applied to the raw match body (post-prefix) so that pattern-specific prefixes
 * like AKIA, sk_live_, ghp_ don't themselves trip the checks.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /EXAMPLE/i,
  /PLACEHOLDER/i,
  /YOUR[_-]?(?:API[_-]?)?(?:KEY|SECRET|TOKEN)/i,
  /INSERT[_-]?HERE/i,
  /REPLACE[_-]?ME/i,
  /CHANGEME/i,
  /^(.)\1{9,}$/,       // 10+ of the same character (XXXXXXXXXX, 0000000000, etc.)
  /^[A-Za-z]{1,4}1234/, // followed immediately by ascending digits — common in docs
];

function isPlaceholder(match: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(match));
}

/**
 * Firebase web config API keys share the AIza… format with restricted Google
 * API keys but are meant to be public — Firebase access control is enforced
 * by Security Rules, not by keeping this key secret. Detect the config
 * context around a match so we don't flag these as leaked credentials.
 */
const FIREBASE_CONTEXT_MARKERS = [
  "firebaseconfig",
  "initializeapp",
  "authdomain",
  "messagingsenderid",
  "storagebucket",
  "databaseurl",
  "measurementid",
  ".firebaseapp.com",
  ".firebaseio.com",
];

function isFirebaseWebConfigContext(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - 400);
  const end = Math.min(text.length, index + length + 400);
  const context = text.slice(start, end).toLowerCase();
  return FIREBASE_CONTEXT_MARKERS.some((marker) => context.includes(marker));
}

export function scanForSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const pat of SECRET_PATTERNS) {
    pat.regex.lastIndex = 0;
    for (const m of text.matchAll(pat.regex)) {
      const matched = m[0];
      if (pat.minMatchLen && matched.length < pat.minMatchLen) continue;
      if (isPlaceholder(matched)) continue;
      if (pat.id === "google-api-key" && isFirebaseWebConfigContext(text, m.index ?? 0, matched.length)) {
        continue;
      }

      let label = pat.label;

      if (pat.id === "generic-password-assign") {
        const value = m[1] ?? matched;
        if (shannonEntropyBitsPerChar(value) < MIN_PASSWORD_ENTROPY_BITS_PER_CHAR) continue;
      }

      if (pat.id === "jwt") {
        const payload = decodeJwtPayload(matched);
        if (!payload) continue; // dot-separated but not real base64url JSON — not a JWT
        if (isExpiredJwtPayload(payload)) label = `${pat.label} (expired)`;
      }

      hits.push({
        patternId: pat.id,
        label,
        index: m.index ?? 0,
        length: matched.length,
        preview: redact(matched),
        valueHash: hashValue(matched),
      });
    }
  }
  return hits;
}
