import type { SeedQuery } from "./types.js";

/**
 * Seed queries for GitHub Code Search.
 *
 * Design rules:
 * - filename: filter where possible — narrows to files likely to hold real secrets
 * - Prefix must be specific enough that the search itself is low-noise
 * - Add queries only for patterns that our detector can actually validate
 * - Expand the list only after confirming FP rate on current queries is acceptable
 *
 * GitHub Code Search docs:
 *   https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax
 */
export const SEED_QUERIES: SeedQuery[] = [
  // ── .env files ────────────────────────────────────────────────────────────
  {
    id: "aws-key-env",
    label: "AWS Access Key ID in .env files",
    q: "AKIA in:file filename:.env",
  },
  {
    id: "stripe-live-env",
    label: "Stripe live secret key in .env files",
    q: "sk_live_ in:file filename:.env",
  },
  {
    id: "stripe-restricted-env",
    label: "Stripe restricted key in .env files",
    q: "rk_live_ in:file filename:.env",
  },
  {
    id: "github-pat-env",
    label: "GitHub PAT in .env files",
    q: "ghp_ in:file filename:.env",
  },
  {
    id: "github-fine-grained-env",
    label: "GitHub fine-grained PAT in .env files",
    q: "github_pat_ in:file filename:.env",
  },
  {
    id: "openai-key-env",
    label: "OpenAI API key in .env files",
    q: "sk-proj- in:file filename:.env",
  },
  {
    id: "anthropic-key-env",
    label: "Anthropic API key in .env files",
    q: "sk-ant- in:file filename:.env",
  },
  {
    id: "slack-token-env",
    label: "Slack token in .env files",
    q: "xoxb- in:file filename:.env",
  },
  {
    id: "google-api-env",
    label: "Google API key in .env files",
    q: "AIza in:file filename:.env",
  },

  // ── Committed private key files ───────────────────────────────────────────
  {
    id: "openssh-key",
    label: "OpenSSH private key in committed key files",
    q: "BEGIN OPENSSH PRIVATE KEY in:file filename:id_rsa OR filename:id_ed25519 OR filename:id_ecdsa OR filename:.pem",
  },
  {
    id: "rsa-key",
    label: "RSA private key in committed key files",
    q: "BEGIN RSA PRIVATE KEY in:file filename:id_rsa OR filename:private_key.pem OR filename:private.pem OR filename:.pem",
  },
];
