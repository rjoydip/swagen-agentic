#!/bin/bash
# scripts/test-webhook.sh — Test Cloudflare Worker webhook endpoint.
#
# Usage:
#   ./scripts/test-webhook.sh [WORKER_URL]
#
# Examples:
#   ./scripts/test-webhook.sh  # Uses default local wrangler dev URL
#   ./scripts/test-webhook.sh https://swagen-agentic.workers.dev
#
# Prerequisites:
#   - Webhook secret must match the one set in Cloudflare Worker
#   - For local testing: bunx wrangler dev --port 8787

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────

WORKER_URL="${1:-http://localhost:8787}"
WEBHOOK_PATH="/webhook"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"

if [ -z "$WEBHOOK_SECRET" ]; then
  echo "Error: WEBHOOK_SECRET environment variable is required."
  echo "Usage: WEBHOOK_SECRET=xxx ./scripts/test-webhook.sh [WORKER_URL]"
  exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ─── Test Counter ───────────────────────────────────────────────────────────

PASSED=0
FAILED=0

# ─── Helper Functions ───────────────────────────────────────────────────────

generate_hmac() {
  local secret="$1"
  local payload="$2"
  echo -n "$payload" | openssl dgst -sha256 -hmac "$secret" | sed 's/^.* //'
}

send_webhook() {
  local event_type="$1"
  local payload="$2"
  local signature
  signature=$(generate_hmac "$WEBHOOK_SECRET" "$payload")

  echo -e "${YELLOW}Sending $event_type webhook...${NC}"
  echo "URL: ${WORKER_URL}${WEBHOOK_PATH}"
  echo "Signature: sha256=${signature}"
  echo "Payload: ${payload}" | head -c 200
  echo -e "\n"

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    "${WORKER_URL}${WEBHOOK_PATH}" \
    -H "Content-Type: application/json" \
    -H "x-hub-signature-256: sha256=${signature}" \
    -H "x-github-event: ${event_type}" \
    -H "x-github-delivery: test-$(date +%s)" \
    -d "$payload")

  local http_code
  http_code=$(echo "$response" | tail -n1)
  local body
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -eq 200 ]; then
    echo -e "${GREEN}✓ Success (HTTP $http_code)${NC}"
    echo "Response: $body"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}✗ Failed (HTTP $http_code)${NC}"
    echo "Response: $body"
    FAILED=$((FAILED + 1))
  fi
}

# ─── Test Cases ─────────────────────────────────────────────────────────────

echo -e "${YELLOW}=== Cloudflare Worker Webhook Tests ===${NC}"
echo "Worker URL: ${WORKER_URL}"
echo ""

# Test 1: Reject non-POST
echo -e "${YELLOW}Test 1: Reject GET request${NC}"
response=$(curl -s -w "\n%{http_code}" "${WORKER_URL}${WEBHOOK_PATH}")
http_code=$(echo "$response" | tail -n1)
if [ "$http_code" -eq 405 ]; then
  echo -e "${GREEN}✓ Correctly rejected GET request (405)${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ Expected 405, got $http_code${NC}"
  FAILED=$((FAILED + 1))
fi
echo ""

# Test 2: Reject non-webhook path
echo -e "${YELLOW}Test 2: Reject non-webhook path${NC}"
response=$(curl -s -w "\n%{http_code}" -X POST "${WORKER_URL}/other")
http_code=$(echo "$response" | tail -n1)
if [ "$http_code" -eq 404 ]; then
  echo -e "${GREEN}✓ Correctly rejected non-webhook path (404)${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ Expected 404, got $http_code${NC}"
  FAILED=$((FAILED + 1))
fi
echo ""

# Test 3: Reject invalid signature
echo -e "${YELLOW}Test 3: Reject invalid signature${NC}"
payload='{"repository":{"full_name":"owner/repo"},"commits":[]}'
response=$(curl -s -w "\n%{http_code}" \
  -X POST \
  "${WORKER_URL}${WEBHOOK_PATH}" \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=invalidsignature" \
  -H "x-github-event: push" \
  -d "$payload")
http_code=$(echo "$response" | tail -n1)
if [ "$http_code" -eq 401 ]; then
  echo -e "${GREEN}✓ Correctly rejected invalid signature (401)${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ Expected 401, got $http_code${NC}"
  FAILED=$((FAILED + 1))
fi
echo ""

# Test 4: Push event without spec changes
echo -e "${YELLOW}Test 4: Push event without spec changes${NC}"
payload='{"repository":{"full_name":"owner/repo"},"commits":[{"added":["README.md"],"modified":["src/index.ts"]}]}'
send_webhook "push" "$payload"
echo ""

# Test 5: Push event with spec changes
echo -e "${YELLOW}Test 5: Push event with spec changes${NC}"
payload='{"repository":{"full_name":"rjoydip/swagen-agentic"},"commits":[{"added":["openapi.yaml"],"modified":[]}]}'
send_webhook "push" "$payload"
echo ""

# Test 6: PR opened event
echo -e "${YELLOW}Test 6: PR opened event${NC}"
payload='{"action":"opened","repository":{"full_name":"rjoydip/swagen-agentic"},"pull_request":{"number":42}}'
send_webhook "pull_request" "$payload"
echo ""

# Test 7: PR synchronize event
echo -e "${YELLOW}Test 7: PR synchronize event${NC}"
payload='{"action":"synchronize","repository":{"full_name":"rjoydip/swagen-agentic"},"pull_request":{"number":42}}'
send_webhook "pull_request" "$payload"
echo ""

# Test 8: PR closed event (should not dispatch)
echo -e "${YELLOW}Test 8: PR closed event (should not dispatch)${NC}"
payload='{"action":"closed","repository":{"full_name":"rjoydip/swagen-agentic"},"pull_request":{"number":42}}'
send_webhook "pull_request" "$payload"
echo ""

# ─── Summary ────────────────────────────────────────────────────────────────

echo -e "${YELLOW}=== Tests Complete ===${NC}"
echo -e "${GREEN}Passed: ${PASSED}${NC}"
echo -e "${RED}Failed: ${FAILED}${NC}"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
