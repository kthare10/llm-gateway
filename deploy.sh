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

# ---- Step 1: Validate prerequisites ----
info "Checking prerequisites..."

if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Install Docker Engine 24+ and Docker Compose v2."
    exit 1
fi

if ! docker compose version &>/dev/null; then
    error "Docker Compose v2 is not available. Install Docker Compose v2."
    exit 1
fi

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

# ---- Step 4: Create external Docker network ----
info "Ensuring llm_backends Docker network exists..."
docker network create llm_backends 2>/dev/null && info "Created llm_backends network" || info "llm_backends network already exists"

# ---- Step 5: Build and start services ----
if [ "$RESTART_ONLY" = true ]; then
    info "Restarting all services..."
    docker compose restart
else
    BUILD_ARGS=""
    if [ "$REBUILD" = true ]; then
        BUILD_ARGS="--no-cache"
        info "Building all images (no cache)..."
    else
        info "Building and starting all services..."
    fi

    docker compose up -d --build $BUILD_ARGS
fi

# ---- Step 6: Wait for health checks ----
info "Waiting for services to become healthy..."

SERVICES=(litellm-db gateway-db redis litellm gateway-api)
MAX_WAIT=120
ELAPSED=0

all_healthy() {
    for svc in "${SERVICES[@]}"; do
        local health
        health=$(docker compose ps --format json "$svc" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null || echo "")
        if [ "$health" != "healthy" ]; then
            return 1
        fi
    done
    return 0
}

while ! all_healthy; do
    if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
        warn "Some services are not healthy after ${MAX_WAIT}s. Check with: docker compose ps"
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    printf "."
done
echo ""

# ---- Step 7: Show status ----
info "Service status:"
docker compose ps

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
    echo "  View logs:     docker compose logs -f"
else
    warn "Deployment started, but TLS certs are missing. NGINX may not be serving HTTPS."
    echo "  Place certs in ssl/ and run: docker compose restart nginx"
fi
