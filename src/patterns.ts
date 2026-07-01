/**
 * Credential-detection patterns ported from SessionGuard / agentaudit.
 * Same regex/entropy detectors, different input source (public GitHub commits
 * instead of local AI agent transcripts). Keep both in sync.
 */

export interface SecretPattern {
  id: string;
  label: string;
  regex: RegExp;
  minMatchLen?: number;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "aws-access-key",
    label: "AWS Access Key ID",
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "aws-secret-key",
    label: "AWS Secret Access Key (assignment)",
    regex:
      /\b(aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/g,
  },
  {
    id: "gcp-service-account",
    label: "GCP Service Account private key",
    regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
  },
  {
    id: "ssh-private-key",
    label: "OpenSSH private key",
    regex: /-----BEGIN OPENSSH PRIVATE KEY-----/g,
  },
  {
    id: "github-token",
    label: "GitHub personal access token",
    regex: /\bghp_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: "github-fine-grained",
    label: "GitHub fine-grained PAT",
    regex: /\bgithub_pat_[A-Za-z0-9_]{80,}\b/g,
  },
  {
    id: "github-oauth",
    label: "GitHub OAuth token",
    regex: /\bgho_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: "slack-token",
    label: "Slack token",
    regex: /\bxox[aboprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "stripe-live-secret",
    label: "Stripe live secret key",
    regex: /\bsk_live_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "stripe-restricted",
    label: "Stripe restricted key",
    regex: /\brk_live_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "anthropic-key",
    label: "Anthropic API key",
    regex: /\bsk-ant-(?:api\d{2}|admin\d{2}|oat\d{2})-[A-Za-z0-9_-]{80,}\b/g,
  },
  {
    id: "openai-key",
    label: "OpenAI API key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g,
  },
  {
    id: "google-api-key",
    label: "Google API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "jwt",
    label: "JWT",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    minMatchLen: 60,
  },
  {
    id: "generic-password-assign",
    label: "password assignment",
    regex: /\b(?:password|passwd|pwd)\s*[=:]\s*["']([^"'\s]{8,})["']/gi,
    minMatchLen: 8,
  },
];

export interface SecretHit {
  patternId: string;
  label: string;
  index: number;
  length: number;
  preview: string;
}

export function redact(match: string): string {
  if (match.length <= 8) return "*".repeat(match.length);
  return `${match.slice(0, 4)}…${match.slice(-4)}`;
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

export function scanForSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const pat of SECRET_PATTERNS) {
    pat.regex.lastIndex = 0;
    for (const m of text.matchAll(pat.regex)) {
      const matched = m[0];
      if (pat.minMatchLen && matched.length < pat.minMatchLen) continue;
      if (isPlaceholder(matched)) continue;
      hits.push({
        patternId: pat.id,
        label: pat.label,
        index: m.index ?? 0,
        length: matched.length,
        preview: redact(matched),
      });
    }
  }
  return hits;
}
