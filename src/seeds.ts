import type { SeedQuery } from "./types.js";

/**
 * Seed queries for GitHub Code Search. Conservative starter set — high
 * signal patterns in .env files. Expand only after confirming low FP rate.
 *
 * GitHub Code Search docs:
 *   https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax
 */
export const SEED_QUERIES: SeedQuery[] = [
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
    id: "github-pat-env",
    label: "GitHub PAT in .env files",
    q: "ghp_ in:file filename:.env",
  },
  {
    id: "openssh-key",
    label: "OpenSSH private key committed",
    q: "BEGIN OPENSSH PRIVATE KEY in:file",
  },
  {
    id: "google-api-env",
    label: "Google API key in .env files",
    q: "AIza in:file filename:.env",
  },
];
