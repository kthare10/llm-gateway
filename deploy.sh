#!/usr/bin/env bash
# deploy.sh -- Automated deployment script for LLM Gateway
# Usage: bash deploy.sh [--rebuild] [--restart-only]
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

have() { command -v "$1" &>/dev/null; }

# Container engine + compose command, resolved in Step 1.
ENGINE=""
COMPOSE=()
# Thin wrapper so call sites read naturally regardless of engine.
compose() { "${COMPOSE[@]}" "$@"; }

# ---- Parse arguments ----
REBUILD=false
RESTART_ONLY=false

for arg in "$@"; do
    case "$arg" in
        --rebuild)      REBUILD=true ;;
        --restart-only) RESTART_ONLY=true ;;
        --help|-h)
            echo "Usage: bash deploy.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --rebuild       Force rebuild all images (no cache)"
            echo "  --restart-only  Restart services without rebuilding"
            echo "  -h, --help      Show this help message"
            echo ""
            echo "First-time deployment:"
            echo "  1. cp .env.example .env"
            echo "  2. Edit .env with your secrets and FQDN"
            echo "  3. Edit config/gateway.yaml (allowed users, admins)"
            echo "  4. Edit litellm/config.yaml (LLM backends)"
            echo "  5. Place TLS certs in ssl/public.pem and ssl/private.pem"
            echo "  6. bash deploy.sh"
            exit 0
            ;;
        *)
            error "Unknown option: $arg"
            exit 1
            ;;
    esac
done

# ---- Step 1: Detect container engine + compose command ----
info "Detecting container engine..."

# Override auto-detection with:  CONTAINER_ENGINE=podman bash deploy.sh
ENGINE="${CONTAINER_ENGINE:-}"

if [ -z "$ENGINE" ]; then
    if have docker && docker compose version &>/dev/null 2>&1; then
        ENGINE="docker"
    elif have docker && have docker-compose; then
        ENGINE="docker"
    elif have podman; then
        ENGINE="podman"
    elif have docker; then
        ENGINE="docker"
    else
        error "No container engine found. Install Docker Engine 24+ (with Compose v2) or Podman 4+."
        exit 1
    fi
fi

case "$ENGINE" in
    docker)
        if ! have docker; then
            error "CONTAINER_ENGINE=docker but 'docker' is not installed."
            exit 1
        fi
        if docker compose version &>/dev/null 2>&1; then
            COMPOSE=(docker compose)
        elif have docker-compose; then
            COMPOSE=(docker-compose)
        else
            error "Docker Compose not available. Install Compose v2 ('docker compose') or docker-compose."
            exit 1
        fi
        ;;
    podman)
        if ! have podman; then
            error "CONTAINER_ENGINE=podman but 'podman' is not installed."
            exit 1
        fi
        if have podman-compose; then
            COMPOSE=(podman-compose)
        elif podman compose version &>/dev/null 2>&1; then
            COMPOSE=(podman compose)
        else
            error "No Podman compose provider found. Install one of:"
            error "  python3 -m ensurepip --user && python3 -m pip install --user podman-compose"
            error "  (or) drop a docker-compose binary at ~/.docker/cli-plugins/docker-compose for 'podman compose'"
            exit 1
        fi
        # Warn early about the most common rootless blocker (see PODMAN.md).
        if [ "$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null)" = "true" ]; then
            if ! grep -q "^$(id -un):" /etc/subuid 2>/dev/null; then
                warn "Rootless podman has no /etc/subuid range for '$(id -un)' -- image unpacking WILL fail."
                warn "A root user must run (once):"
                warn "  sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $(id -un)"
                warn "  then, as $(id -un):  podman system migrate"
                warn "See PODMAN.md for details."
            fi
        fi
        ;;
    *)
        error "Unsupported CONTAINER_ENGINE='$ENGINE' (expected 'docker' or 'podman')."
        exit 1
        ;;
esac

info "Container engine: $ENGINE   |   compose: ${COMPOSE[*]}"

# ---- Step 2: Validate configuration files ----
info "Validating configuration..."

if [ ! -f ".env" ]; then
    error ".env file not found. Run: cp .env.example .env  and fill in the values."
    exit 1
fi

# Source .env to validate key variables
set -a
# shellcheck source=/dev/null
source .env
set +a

REQUIRED_VARS=(GATEWAY_FQDN VOUCH_JWT_SECRET LITELLM_MASTER_KEY LITELLM_POSTGRES_PASSWORD GATEWAY_DB_PASSWORD)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        MISSING+=("$var")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    error "Missing required .env variables: ${MISSING[*]}"
    exit 1
fi

AUTH_PROVIDER="${AUTH_PROVIDER:-github}"
case "$AUTH_PROVIDER" in
    github)
        if [ -z "${GITHUB_CLIENT_ID:-}" ] || [ -z "${GITHUB_CLIENT_SECRET:-}" ]; then
            error "AUTH_PROVIDER=github requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env"
            exit 1
        fi
        ;;
    cilogon)
        if [ -z "${CILOGON_CLIENT_ID:-}" ] || [ -z "${CILOGON_CLIENT_SECRET:-}" ]; then
            error "AUTH_PROVIDER=cilogon requires CILOGON_CLIENT_ID and CILOGON_CLIENT_SECRET in .env"
            exit 1
        fi
        ;;
    *)
        error "AUTH_PROVIDER must be 'github' or 'cilogon', got: $AUTH_PROVIDER"
        exit 1
        ;;
esac

if [ ! -f "config/gateway.yaml" ]; then
    error "config/gateway.yaml not found."
    exit 1
fi

if [ ! -f "litellm/config.yaml" ]; then
    error "litellm/config.yaml not found."
    exit 1
fi

# Check TLS certs -- look for either naming convention
SSL_OK=true
if [ -f "ssl/public.pem" ] && [ -f "ssl/private.pem" ]; then
    info "TLS certs found: ssl/public.pem, ssl/private.pem"
elif [ -f "ssl/fullchain.pem" ] && [ -f "ssl/privkey.pem" ]; then
    info "TLS certs found: ssl/fullchain.pem, ssl/privkey.pem"
else
    warn "TLS certificates not found in ssl/. NGINX will fail to start without them."
    warn "Place your cert chain and private key as ssl/fullchain.pem and ssl/privkey.pem"
    SSL_OK=false
fi

info "Configuration valid (AUTH_PROVIDER=$AUTH_PROVIDER, FQDN=$GATEWAY_FQDN)"

# ---- Step 3: Generate Vouch Proxy config ----
info "Generating Vouch Proxy configuration..."
bash vouch/generate-config.sh

# ---- Step 4: Create external container network ----
info "Ensuring llm_backends network exists..."
if "$ENGINE" network create llm_backends 2>/dev/null; then
    info "Created llm_backends network"
else
    info "llm_backends network already exists"
fi

# ---- Step 5: Build and start services ----
if [ "$RESTART_ONLY" = true ]; then
    info "Restarting all services..."
    compose restart
else
    if [ "$REBUILD" = true ]; then
        info "Building all images (no cache)..."
        compose build --no-cache
    else
        info "Building images..."
        compose build
    fi
    info "Starting all services..."
    compose up -d
fi

# ---- Step 6: Wait for health checks ----
info "Waiting for services to become healthy..."

# Wait on container_name values (set in docker-compose.yml) rather than compose
# service names, so the same logic works for docker compose and podman-compose.
# All five have a healthcheck, so their `ps` Status reads "... (healthy)" when ready.
HEALTH_CONTAINERS=(llm-gw-litellm-db llm-gw-gateway-db llm-gw-redis llm-gw-litellm llm-gw-api)
MAX_WAIT=120
ELAPSED=0

container_status() {
    # Loose name filter, then exact-match the Names column ourselves. This avoids
    # engine-specific regex anchoring: Docker stores container names with a leading
    # '/', so a "name=^foo$" filter matches nothing on Docker (works on Podman).
    # `docker/podman ps` both print Names without the slash, so an exact string
    # compare in awk is reliable on either engine.
    "$ENGINE" ps --filter "name=$1" --format "{{.Names}}\t{{.Status}}" 2>/dev/null \
        | awk -F'\t' -v n="$1" '$1 == n { print $2 }'
}

all_healthy() {
    local c s
    for c in "${HEALTH_CONTAINERS[@]}"; do
        s=$(container_status "$c")
        case "$s" in
            *"(healthy)"*) ;;   # ready
            *) return 1 ;;
        esac
    done
    return 0
}

while ! all_healthy; do
    if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
        warn "Some services are not healthy after ${MAX_WAIT}s. Check with: ${COMPOSE[*]} ps"
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    printf "."
done
echo ""

# ---- Step 7: Show status ----
info "Service status:"
compose ps

echo ""
if [ "$SSL_OK" = true ]; then
    info "Deployment complete!"
    echo ""
    echo "  Landing page:  https://${GATEWAY_FQDN}/"
    echo "  API Keys:      https://${GATEWAY_FQDN}/keys"
    echo "  Admin:         https://${GATEWAY_FQDN}/admin"
    echo "  LiteLLM UI:    https://${GATEWAY_FQDN}/litellm/"
    echo "  LLM API:       https://${GATEWAY_FQDN}/v1/"
    echo ""
    echo "  View logs:     ${COMPOSE[*]} logs -f"
else
    warn "Deployment started, but TLS certs are missing. NGINX may not be serving HTTPS."
    echo "  Place certs in ssl/ and run: ${COMPOSE[*]} restart nginx"
fi
