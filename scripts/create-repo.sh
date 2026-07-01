#!/usr/bin/env bash
# Creates the publicguard GitHub repo with the opt-out label in place before
# the repo ever becomes public. Sequence:
#   1. Create repo as PRIVATE
#   2. Add git remote and push
#   3. Create opt-out label
#   4. Flip repo to PUBLIC
#
# Run from the publicguard project root:
#   GITHUB_TOKEN=ghp_... ./scripts/create-repo.sh
#
# Requires: curl, git

set -euo pipefail

OWNER="Product-nomad"
REPO="publicguard"
DESCRIPTION="Good-faith secret-leak notifier for public GitHub repos — finds exposed credentials, tells owners privately, no shaming, no sales pitch."
API="https://api.github.com"

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: GITHUB_TOKEN is not set."
  echo "Export it first: export GITHUB_TOKEN=ghp_..."
  exit 1
fi

AUTH_HEADER="Authorization: Bearer ${GITHUB_TOKEN}"

echo "Checking token…"
AUTHED_USER=$(curl -sf -H "$AUTH_HEADER" "$API/user" | grep '"login"' | sed 's/.*: *"\(.*\)".*/\1/')
echo "  Authenticated as: ${AUTHED_USER}"

if [[ "$AUTHED_USER" != "$OWNER" ]]; then
  echo "Warning: token belongs to '${AUTHED_USER}', expected '${OWNER}'."
  echo "Press enter to continue anyway, or Ctrl-C to abort."
  read -r
fi

# ---------------------------------------------------------------------------
# Step 1: Create repo as PRIVATE
# ---------------------------------------------------------------------------

echo ""
echo "Step 1/4: Creating ${OWNER}/${REPO} as private…"

CREATE_RESPONSE=$(curl -sf \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$API/user/repos" \
  -d "{
    \"name\": \"${REPO}\",
    \"description\": \"${DESCRIPTION}\",
    \"private\": true,
    \"has_issues\": true,
    \"has_wiki\": false,
    \"has_projects\": false,
    \"auto_init\": false
  }")

HTML_URL=$(echo "$CREATE_RESPONSE" | grep '"html_url"' | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
echo "  Created: ${HTML_URL} (private)"

# ---------------------------------------------------------------------------
# Step 2: Push
# ---------------------------------------------------------------------------

echo ""
echo "Step 2/4: Adding remote and pushing…"

if git remote get-url origin &>/dev/null; then
  echo "  Remote 'origin' already exists — skipping remote add."
else
  git remote add origin "https://github.com/${OWNER}/${REPO}.git"
fi

git push -u origin main
echo "  Pushed."

# ---------------------------------------------------------------------------
# Step 3: Create opt-out label (while still private)
# ---------------------------------------------------------------------------

echo ""
echo "Step 3/4: Creating opt-out label…"

LABEL_RESPONSE=$(curl -s \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$API/repos/${OWNER}/${REPO}/labels" \
  -d '{
    "name": "opt-out",
    "color": "0075ca",
    "description": "Request to exclude this repo or account from future scans"
  }')

if echo "$LABEL_RESPONSE" | grep -q '"id"'; then
  echo "  Label 'opt-out' created."
else
  echo "  Error creating label:"
  echo "$LABEL_RESPONSE"
  echo ""
  echo "Aborting — fix the label issue before making the repo public."
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 4: Flip to PUBLIC — only now
# ---------------------------------------------------------------------------

echo ""
echo "Step 4/4: Making repo public…"

curl -sf \
  -X PATCH \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$API/repos/${OWNER}/${REPO}" \
  -d '{"private": false}' \
  > /dev/null

echo "  Repo is now public: https://github.com/${OWNER}/${REPO}"
echo ""
echo "Done. Label 'opt-out' exists and the opt-out link in the README is live."
echo "Verify: https://github.com/${OWNER}/${REPO}/labels"
