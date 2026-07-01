# Design decisions

## Contact channel: GitHub Issues, not email

GitHub Issues use GitHub's own notification system — the owner gets a notification through the same channel they already use. It's publicly attributable (the issue is visible if the owner makes it so), can't be mistaken for phishing the way a cold email from an unknown sender can, and doesn't require scraping any PII to find a contact address.

## Human review before every post (during shadow mode)

The failure mode — a badly-worded template or broken detector posting to strangers' repos under a real identity — is expensive and public. So: full pipeline runs in shadow mode first, all findings go into a local review queue, nothing is posted until reviewed. The pipeline graduates to autonomous posting only after a batch has been inspected and the false-positive rate looks acceptable.

## Never validate credentials

Calling a found API key to confirm it's live would be unauthorized use of someone else's credential. It's not done. The template says "possible" and "I think I spotted" deliberately, because the scanner can't confirm liveness without using the key.

## Never store the credential value

Only metadata is written to the local database: repo, file path, commit SHA, detector type, timestamp. The raw match is never persisted. This removes any "did you access my account" ambiguity and matches the local-only ethos of SessionGuard.

One addition: a SHA-256 hash of the raw match (`value_hash`) is now stored, to recognize when the same credential shows up in more than one file in the same repo and avoid opening a separate issue for each occurrence. A one-way hash can't be reversed to recover the credential and can't be used to authenticate anywhere, so it doesn't reopen the "did you access my account" question — it's a fingerprint, not the value.

## Daily cap + kill switch, permanent

The daily cap and kill switch are baked into the posting path from day one and are not removable by a mode flag. Even at full autonomy the cap applies. The blast radius of any future bug in the detector or template is bounded to one day's worth of posts before a human notices.

## Detection engine shared with SessionGuard / agentaudit

The regex/entropy patterns in `src/patterns.ts` are ported directly from [agentaudit](https://github.com/sessionguard/sessionguard)'s `src/rules/patterns.ts`. The intent is one ruleset, two input sources: local AI agent transcripts (SessionGuard) and public GitHub commits (PublicGuard). When a pattern is updated in one, it should be updated in both.

## Opt-out respected immediately

An opt-out request (GitHub Issue on this repo, or a `.publicguard-ignore` file in a target repo) excludes the owner or repo from all future scans. Exclusions are stored locally and checked before the scan reaches the API-call or queuing stage — not just before posting.
