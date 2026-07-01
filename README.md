# PublicGuard

A free, non-commercial scanner that finds exposed API keys and credentials in public GitHub repositories and notifies owners via a GitHub Issue — constructively, privately-but-publicly, with no shaming and no sales pitch.

---

## What this is

Credentials get committed to public repos. It happens to experienced developers and it happens a lot to less-experienced or AI-assisted builders. The usual public response — call-out posts, social ridicule — is loud and unhelpful.

PublicGuard takes a different approach: find the leak, tell the owner privately via their own repo's issue tracker, tell them exactly what to do, and say nothing else. No badge of shame, no thread, no audience. Just signal.

**It is free. It is non-commercial. The first message contains zero sales pitch.**

---

## What it does

1. Runs periodic searches across public GitHub using the [GitHub Code Search API](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28)
2. Applies a credential-detection ruleset (AWS keys, GitHub PATs, Stripe live keys, SSH private keys, Google API keys, and others)
3. Filters out intentional examples: files in `test/`, `example/`, `.env.example`, `fixtures/`, tutorial paths, etc.
4. Queues every candidate finding for human review before anything is posted
5. Opens a single GitHub Issue on the affected repo with the file path, a remediation checklist, and nothing else

---

## What it does not do

- **Does not access, test, or validate found credentials.** The value is never used. Calling a leaked API key to confirm it's live would be unauthorized use of someone else's credential. That's out of scope, permanently.
- **Does not store the credential value.** Only metadata is recorded: repo name, file path, commit SHA, detector type, timestamp. The actual secret never touches this system's database.
- **Does not sell, share, or publish findings.** Each notification goes to the affected repo owner only. Nothing is aggregated or made public.
- **Does not spam.** A hard daily cap limits how many issues are opened per day. Each finding is reviewed before posting. If a repo owner asks to be excluded, they are.

---

## How notifications look

Issues are opened under the [Product Nomad](https://github.com/productnomad) GitHub account with the title **"Possible exposed credential in this repo"** and a fixed template:

- What was found (file path and commit SHA — no credential value)
- What to do (rotate the credential, remove from git history, use env vars going forward)
- A link to GitHub's own documentation on removing sensitive data
- One sentence explaining what this scan is, with a link back here

No follow-up. No reply required. Close the issue when handled.

---

## Who's behind this

This is run by [Product Nomad](https://github.com/productnomad) as part of an open security tooling project. PublicGuard is a companion to [SessionGuard](https://sessionguard.dev), which audits local AI agent sessions for exactly the same class of credential leak. The detection ruleset is shared between both tools.

This is not a company. There is no enterprise tier. There is no upsell.

---

## Opt-out

If you'd prefer not to receive notifications for your repos or organisation:

**[Open an issue on this repository](../../issues/new?title=Opt-out+request&labels=opt-out)** with the title `Opt-out: owner/repo` or `Opt-out: @owner` (for all repos under an account). You'll be excluded from all future scans within 24 hours.

You can also opt out a repo yourself by adding a `.publicguard-ignore` file anywhere in it. The scanner respects this file and will skip the repo without notifying you.

---

## Source and transparency

This repository contains the full source for the scanner. The detection patterns, false-positive filters, issue template, and daily-cap guardrails are all here and auditable.

Key design choices are documented in [`DECISIONS.md`](./DECISIONS.md).

---

## Feedback

If a notification was wrong — a false positive, an unhelpful message, a tone issue — please say so in the issue or open one here. The goal is to be useful, not to generate noise.
