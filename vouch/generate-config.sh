#!/usr/bin/env bash
# Generates vouch/config.yaml from the appropriate template and .env values.
# Run this before 'docker compose up'.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Source .env
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "ERROR: $PROJECT_DIR/.env not found. Copy .env.example to .env and fill in values." >&2
    exit 1
fi
set -a
# shellcheck source=/dev/null
source "$PROJECT_DIR/.env"
set +a

AUTH_PROVIDER="${AUTH_PROVIDER:-github}"

case "$AUTH_PROVIDER" in
    cilogon)
        TEMPLATE="$SCRIPT_DIR/config-cilogon.yaml"
        ;;
    github)
        TEMPLATE="$SCRIPT_DIR/config-github.yaml"
        ;;
    *)
        echo "ERROR: Unknown AUTH_PROVIDER='$AUTH_PROVIDER'. Must be 'cilogon' or 'github'." >&2
        exit 1
        ;;
esac

echo "Generating vouch/config.yaml from $AUTH_PROVIDER template..."

sed \
    -e "s|GATEWAY_FQDN|${GATEWAY_FQDN}|g" \
    -e "s|VOUCH_JWT_SECRET|${VOUCH_JWT_SECRET}|g" \
    -e "s|CILOGON_CLIENT_ID|${CILOGON_CLIENT_ID:-}|g" \
    -e "s|CILOGON_CLIENT_SECRET|${CILOGON_CLIENT_SECRET:-}|g" \
    -e "s|GITHUB_CLIENT_ID|${GITHUB_CLIENT_ID:-}|g" \
    -e "s|GITHUB_CLIENT_SECRET|${GITHUB_CLIENT_SECRET:-}|g" \
    "$TEMPLATE" > "$SCRIPT_DIR/config.yaml"

echo "Done. vouch/config.yaml generated for AUTH_PROVIDER=$AUTH_PROVIDER"
