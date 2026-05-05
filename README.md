# LLM Gateway

A standalone, self-service platform for managing LLM API access. It places [LiteLLM](https://github.com/BerriAI/litellm) in front of any combination of LLM backends (Azure OpenAI, vLLM, Ollama, OpenAI, etc.), authenticates users via [CILogon](https://www.cilogon.org/) institutional OIDC or [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps), and lets each user create and manage their own API keys with optional per-key budgets, model restrictions, and expiration dates -- all without writing any application code.

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Directory Layout](#directory-layout)
- [Quick Start](#quick-start)
- [Deployment Guide](#deployment-guide)
  - [Step 1 -- Choose an Auth Provider and Register](#step-1----choose-an-auth-provider-and-register)
  - [Step 2 -- Clone and Configure Secrets](#step-2----clone-and-configure-secrets)
  - [Step 3 -- Configure Access Control and Token Policies](#step-3----configure-access-control-and-token-policies)
  - [Step 4 -- Configure LLM Backends](#step-4----configure-llm-backends)
  - [Step 5 -- Place TLS Certificates](#step-5----place-tls-certificates)
  - [Step 6 -- Launch](#step-6----launch)
  - [Step 7 -- Verify](#step-7----verify)
- [Adding or Changing LLM Backends](#adding-or-changing-llm-backends)
- [Services Reference](#services-reference)
- [Networking](#networking)
- [Authentication Flow](#authentication-flow)
- [API Reference](#api-reference)
- [Access Control Modes](#access-control-modes)
- [Token Policies](#token-policies)
- [Frontend Pages](#frontend-pages)
- [Security Model](#security-model)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
                      HTTPS (:443)
                          |
                          v
          +-------------------------------+
          |     NGINX (SSL + Routing)     |
          |                               |
          |  /          --> gateway-app   |  (public landing page)
          |  /keys,/admin -> gateway-app  |  (Vouch-protected)
          |  /api/v1/*  --> gateway-api   |  (Vouch-protected)
          |  /auth,/login --> vouch-proxy |  (CILogon or GitHub OAuth)
          |  /v1/*      --> litellm      |  (LLM proxy, virtual key auth)
          |  /litellm/  --> litellm      |  (LiteLLM admin UI, Vouch-protected)
          +-------------------------------+
                |       |       |       |
      +---------+   +---+---+  ++-+  +--+------+
      |             |       |  |   |  |         |
      v             v       v  v   v  v         v
  gateway-app  gateway-api  vouch litellm   redis
  (Next.js)    (FastAPI)    proxy  proxy
                  |                  |
                  v                  v
             gateway-db         litellm-db      LLM Backends
             (PostgreSQL)       (PostgreSQL)    (Azure/vLLM/Ollama/...)
```

**Key principle:** The LiteLLM master key is internal-only. Users never see it. The `gateway-api` mediates all key management through LiteLLM's admin API. Users hit `/v1/*` with their own virtual keys for actual LLM calls.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Docker Engine 24+ and Docker Compose v2 | `docker compose version` to check |
| A server with a public FQDN | e.g. `llm-gateway.example.com` |
| TLS certificate + private key | Let's Encrypt, institutional CA, or self-signed for testing |
| An auth provider registration | CILogon OIDC (https://cilogon.org/oauth2/register) **or** GitHub OAuth App (https://github.com/settings/applications/new) |
| At least one LLM backend | Azure OpenAI key, OpenAI key, or a self-hosted vLLM/Ollama instance |

---

## Directory Layout

```
llm-gateway/
  docker-compose.yml              # All 8 services
  deploy.sh                       # Automated deployment script
  .env.example                    # Template -- committed to repo
  .env                            # Your secrets -- NOT committed
  README.md
  config/
    gateway.yaml                  # Access control & token policies
  litellm/
    config.yaml                   # LLM backend definitions
  nginx/
    default.conf                  # Routing rules & Vouch auth_request
    nginx.conf                    # Worker/buffer settings
  ssl/
    public.pem                    # TLS certificate chain
    private.pem                   # TLS private key
  vouch/
    config-cilogon.yaml           # Vouch template for CILogon OIDC
    config-github.yaml            # Vouch template for GitHub OAuth
    generate-config.sh            # Generates config.yaml from template + .env
  gateway-api/                    # FastAPI backend
    Dockerfile
    pyproject.toml
    gateway_api/
      main.py                    # App entry point, router registration
      config.py                  # YAML config loader + env settings
      auth/
        dependencies.py          # FastAPI deps: extract user from Vouch headers
        access_control.py        # Domain / group / allow_all enforcement
      routers/
        keys.py                  # POST/GET/DELETE /api/v1/keys
        models.py                # GET /api/v1/models
        users.py                 # GET /api/v1/me
        admin.py                 # GET /api/v1/admin/*
      services/
        litellm_client.py        # Async httpx client for LiteLLM admin API
        key_service.py           # Key CRUD business logic + config snippets
      db/
        session.py               # SQLAlchemy async session factory
        models.py                # ORM: AuditLog, UserRecord
  gateway-app/                   # Next.js frontend
    Dockerfile
    package.json
    src/
      app/
        layout.tsx               # Root layout with Toaster
        page.tsx                 # Public landing page with login
        keys/page.tsx            # Token create/list/delete UI
        admin/page.tsx           # Admin dashboard
      components/
        logo.tsx                 # SVG gateway logo component
        navbar.tsx               # Auth-aware navigation bar
      services/
        gateway-api-service.ts   # Typed fetch wrapper for all API calls
```

---

## Quick Start

For automated deployment, use the included `deploy.sh` script:

```bash
git clone <this-repo-url> llm-gateway
cd llm-gateway
cp .env.example .env
# Edit .env with your values (FQDN, auth credentials, API keys, etc.)
# Edit config/gateway.yaml (allowed users, admin users)
# Edit litellm/config.yaml (LLM backend models)
# Place TLS certs in ssl/public.pem and ssl/private.pem
bash deploy.sh
```

See the [Deployment Guide](#deployment-guide) for detailed instructions on each step.

---

## Deployment Guide

### Step 1 -- Choose an Auth Provider and Register

The gateway supports two authentication providers. Pick one at deploy time via the `AUTH_PROVIDER` env var.

**Option A: CILogon OIDC** (institutional login)

1. Go to https://cilogon.org/oauth2/register
2. Fill in:
   - **Client Name:** a descriptive name (e.g. "LLM Gateway - My Org")
   - **Callback URLs:** `https://<your-FQDN>/auth`
   - **Scopes:** check `openid`, `email`, `profile`
3. Save the **Client ID** and **Client Secret**.

**Option B: GitHub OAuth**

1. Go to https://github.com/settings/applications/new
2. Fill in:
   - **Application name:** a descriptive name (e.g. "LLM Gateway")
   - **Homepage URL:** `https://<your-FQDN>`
   - **Authorization callback URL:** `https://<your-FQDN>/auth`
3. Save the **Client ID** and **Client Secret**.

### Step 2 -- Clone and Configure Secrets

```bash
git clone <this-repo-url> llm-gateway
cd llm-gateway

cp .env.example .env
```

Edit `.env` and fill in the values. Set `AUTH_PROVIDER` and the matching credentials:

```bash
# The public hostname users will visit
GATEWAY_FQDN=llm-gateway.example.com

# Choose your auth provider: "github" (default) or "cilogon"
AUTH_PROVIDER=github

# CILogon credentials (required when AUTH_PROVIDER=cilogon)
CILOGON_CLIENT_ID=cilogon:/client_id/abc123
CILOGON_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxx

# GitHub credentials (required when AUTH_PROVIDER=github)
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Random string >= 44 characters. Generate one with:
#   openssl rand -base64 33
VOUCH_JWT_SECRET=<your-random-jwt-secret>

# Internal master key for LiteLLM admin API. Generate with:
#   openssl rand -hex 24
LITELLM_MASTER_KEY=sk-<your-random-master-key>

# LiteLLM UI credentials (for accessing /litellm/ admin panel)
LITELLM_UI_USERNAME=admin
LITELLM_UI_PASSWORD=<your-litellm-ui-password>

# Database passwords. Generate with:
#   openssl rand -hex 16
LITELLM_POSTGRES_PASSWORD=<random-password>
GATEWAY_DB_PASSWORD=<random-password>

# (Optional) If you use cloud LLM providers:
# AZURE_API_KEY=your-azure-key
# OPENAI_API_KEY=your-openai-key
```

### Step 3 -- Configure Access Control and Token Policies

Edit `config/gateway.yaml`:

```yaml
access_control:
  # Choose one mode:
  #   "allow_all"    -- any authenticated user can access (works with both providers)
  #   "domain"       -- only users with matching email domains (CILogon only)
  #   "group"        -- only members of specific CILogon groups (CILogon only)
  #   "github_org"   -- only members of specific GitHub orgs (GitHub only)
  #   "github_users" -- only specific GitHub usernames (GitHub only, default)
  mode: "github_users"

  allowed_github_users:             # used when mode: "github_users" (GitHub, default)
    - "alice"
    - "bob"

  allowed_github_orgs:              # used when mode: "github_org" (GitHub)
    - "my-github-org"

  allowed_domains:                  # used when mode: "domain" (CILogon)
    - "@example.org"
    - "@example.edu"

  allowed_groups:                   # used when mode: "group" (CILogon)
    - "urn:mace:cilogon.org:group:my-llm-users"

  admin_emails:                     # admin users for CILogon (email-based)
    - "admin@example.org"
    - "pi@example.edu"

  admin_users:                      # admin users for GitHub (username-based)
    - "github-admin-username"

tokens:
  max_keys_per_user: 10             # max active keys per user
  # max_duration_days: 30           # omit to allow never-expiring keys
  # default_max_budget: 10.0        # omit for unlimited budget per key
```

See [Access Control Modes](#access-control-modes) for details on each mode. See [Token Policies](#token-policies) for budget and duration options.

### Step 4 -- Configure LLM Backends

Edit `litellm/config.yaml` to add your actual LLM backends:

**Azure OpenAI:**
```yaml
model_list:
  - model_name: gpt-5.4-mini
    litellm_params:
      model: azure/gpt-5.4-mini
      api_base: https://myorg.cognitiveservices.azure.com/
      api_key: os.environ/AZURE_API_KEY
      api_version: "2024-12-01-preview"
    model_info:
      description: "Azure OpenAI GPT-5.4-mini"
      supports_function_calling: true
```

**OpenAI Direct:**
```yaml
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
```

**Self-hosted vLLM** (running on the same Docker host or reachable network):
```yaml
  - model_name: llama-70b
    litellm_params:
      model: hosted_vllm/llama-70b
      api_base: http://vllm-server:8000/v1
      api_key: "not-used"
      rpm: 150
      tpm: 150000
    model_info:
      supports_function_calling: true
```

**Ollama:**
```yaml
  - model_name: mistral
    litellm_params:
      model: ollama/mistral
      api_base: http://ollama:11434
```

You can combine as many backends as you like. LiteLLM will route requests by model name. Full reference: [LiteLLM Proxy Config](https://docs.litellm.ai/docs/proxy/configs).

### Step 5 -- Place TLS Certificates

```bash
# Copy your certificate chain and private key into the ssl/ directory:
cp /path/to/your/fullchain.pem ssl/public.pem
cp /path/to/your/privkey.pem   ssl/private.pem

# Ensure the private key is readable by Docker:
chmod 644 ssl/public.pem
chmod 600 ssl/private.pem
```

For **testing only**, you can generate a self-signed certificate:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/private.pem \
  -out ssl/public.pem \
  -subj "/CN=llm-gateway.example.com"
```

### Step 6 -- Launch

```bash
# Run the deployment script (handles Vouch config generation, network setup, and build)
bash deploy.sh

# Or do it manually:
# 1. Generate Vouch config from template
bash vouch/generate-config.sh

# 2. Create the external network for self-hosted model containers
docker network create llm_backends 2>/dev/null || true

# 3. Build and start all 8 services
docker compose up -d --build

# 4. Watch logs until everything is healthy
docker compose logs -f
```

Wait until you see health checks passing for `litellm`, `gateway-api`, `litellm-db`, `gateway-db`, and `redis`. NGINX will start last since it depends on the others.

Check service health:

```bash
docker compose ps
```

All 8 services should show `Up` or `Up (healthy)`.

### Step 7 -- Verify

1. **Open your browser** and visit `https://<your-FQDN>`
2. You should see the **landing page** with the gateway logo, tagline, feature highlights, and a **Login** button
3. Click **Login** -- you are redirected to GitHub (or CILogon) for authentication
4. After authenticating, you land on the **API Keys** page (`/keys`) with the navbar showing **API Keys**, **Admin** (if you're an admin), and **Logout**
5. **Create a test key:** enter a name, pick a duration (default: Never) and model(s), click "Create Key"
6. The key is shown once with tabs for **API Key**, **Chatbox config**, **Claude Code config**, **OpenCode config**, **curl**, and **Python** snippets
7. **Test the key** from your terminal:

```bash
curl -s https://llm-gateway.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "gpt-5.4-mini",
    "messages": [{"role": "user", "content": "Hello, world!"}]
  }' | python3 -m json.tool
```

8. Back in the browser, verify the key appears in "Your API Keys" with spend tracking
9. **Delete the test key** -- confirm it no longer works
10. If your identity is in `admin_users` (GitHub) or `admin_emails` (CILogon), visit `/admin` to see the admin dashboard
11. Click **Logout** -- you are returned to the public landing page

---

## Adding or Changing LLM Backends

This requires **no code changes** -- only a config edit and a container restart:

```bash
# 1. Edit the backend list
vim litellm/config.yaml

# 2. Restart only the LiteLLM container
docker compose restart litellm

# 3. Verify the new models appear
curl -s https://llm-gateway.example.com/v1/models \
  -H "Authorization: Bearer sk-..." | python3 -m json.tool
```

New models appear in the frontend key creation form immediately after the restart.

### Connecting self-hosted models (vLLM, Ollama, etc.)

If your model containers run on the same Docker host, attach them to the `llm_backends` network so LiteLLM can reach them by container name:

```bash
# In your model's docker-compose.yml, add:
networks:
  llm_backends:
    external: true

# Or attach a running container manually:
docker network connect llm_backends <container-name>
```

Then reference the container hostname in `litellm/config.yaml`:

```yaml
- model_name: llama-70b
  litellm_params:
    model: hosted_vllm/llama-70b
    api_base: http://<container-name>:8000/v1
```

---

## Services Reference

| Service | Container Name | Image | Internal Port | Role |
|---------|---------------|-------|---------------|------|
| `nginx` | llm-gw-nginx | nginx:1-alpine | 80, 443 (exposed) | SSL termination, request routing, Vouch `auth_request` |
| `gateway-app` | llm-gw-app | custom (Next.js) | 3000 | Landing page, token management UI, admin dashboard |
| `gateway-api` | llm-gw-api | custom (FastAPI) | 8000 | Token CRUD API, access control, LiteLLM admin client |
| `vouch-proxy` | llm-gw-vouch | quay.io/vouch/vouch-proxy | 9090 | CILogon OIDC or GitHub OAuth authentication, JWT cookie issuance |
| `litellm` | llm-gw-litellm | ghcr.io/berriai/litellm:main-stable | 4000 | OpenAI-compatible LLM proxy with virtual key auth |
| `litellm-db` | llm-gw-litellm-db | postgres:15-alpine | 5432 | LiteLLM user/key/spend persistence |
| `gateway-db` | llm-gw-gateway-db | postgres:15-alpine | 5432 | Audit trail, user records |
| `redis` | llm-gw-redis | redis:7-alpine | 6379 | LiteLLM caching, routing state, load balancing |

---

## Networking

Three Docker networks isolate traffic:

| Network | Type | Purpose | Connected Services |
|---------|------|---------|-------------------|
| `frontend` | bridge | NGINX-facing services | nginx, gateway-app, gateway-api, vouch-proxy, litellm |
| `backend` | internal (no external access) | Databases, Redis, inter-service | gateway-api, litellm, litellm-db, gateway-db, redis |
| `llm_backends` | external | Self-hosted model containers | litellm, your vLLM/Ollama containers |

The `backend` network is marked `internal: true`, which means containers on it cannot reach the internet. This is intentional -- databases and Redis should never be exposed.

---

## Authentication Flow

The landing page at `/` is **public** (no authentication required). All other pages (`/keys`, `/admin`, `/api/v1/*`) require authentication.

```
User browser
  |
  |-- GET / ---------------------------------> NGINX
  |                                              |
  |                                     (no auth_request -- public)
  |                                              |
  |  <-- 200 (landing page) -------------------+
  |
  |-- Click "Login" -> GET /keys ------> NGINX
  |                                        |
  |                               auth_request /validate
  |                                        |
  |                                   Vouch Proxy
  |                                   (no valid cookie)
  |                                        |
  |  <-- 302 redirect to /login -----------+
  |
  |-- GET /login ----> Vouch ----> 302 to IdP (CILogon or GitHub)
  |
  |-- (user authenticates at their IdP)
  |
  |-- GET /auth (OAuth callback) ----> Vouch
  |                                       |
  |  <-- Set-Cookie: llm-gateway=<JWT> ---+
  |  <-- 302 redirect to /keys -----------+
  |
  |-- GET /keys (with cookie) -------> NGINX
  |                                      |
  |                             auth_request /validate --> Vouch (valid!)
  |                                      |
  |                             sets X-Vouch-User header
  |                                      |
  |                             proxy_pass to gateway-app
  |  <-- 200 (keys page) ---------------+
```

For **LLM API calls**, authentication bypasses Vouch entirely:

```
Client (curl, Python, Chatbox, Claude Code, OpenCode)
  |
  |-- POST /v1/chat/completions
  |   Authorization: Bearer sk-...
  |                                 |
  |                          NGINX proxies directly to LiteLLM
  |                          (no auth_request -- /v1/* is unprotected by Vouch)
  |                                 |
  |                          LiteLLM validates the virtual key
  |                          and proxies to the LLM backend
  |  <-- 200 (LLM response) -------+
```

---

## API Reference

### User Endpoints (browser auth via Vouch cookie)

| Method | Path | Description | Request Body |
|--------|------|-------------|-------------|
| `GET` | `/api/v1/me` | Current user profile (user_id, email, admin status) | -- |
| `GET` | `/api/v1/models` | Available models + API host URL | -- |
| `POST` | `/api/v1/keys` | Create a new API key | `{"name": "my-key", "comment": "optional", "duration_days": 7, "models": ["gpt-5.4-mini"]}` |
| `GET` | `/api/v1/keys` | List caller's active keys | -- |
| `GET` | `/api/v1/keys/{key_id}` | Key details + spend | -- |
| `DELETE` | `/api/v1/keys/{key_id}` | Delete (revoke) a key | -- |

**Key creation options:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Human-readable key name |
| `comment` | string | null | Optional description |
| `duration_days` | integer or null | null (never expires) | Key lifetime in days. Omit for non-expiring keys. |
| `models` | string[] | all models | Restrict key to specific models |
| `max_budget` | float or null | unlimited | USD spending cap for this key |

### Admin Endpoints (requires `admin_emails` or `admin_users` membership)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/users` | All users with spend |
| `GET` | `/api/v1/admin/usage` | Aggregate spend stats |
| `DELETE` | `/api/v1/admin/users/{uid}/keys/{kid}` | Admin-delete any key |

### LLM Proxy Passthrough (virtual key auth -- no Vouch)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completions |
| `POST` | `/v1/completions` | Text completions |
| `POST` | `/v1/embeddings` | Embeddings |
| `GET` | `/v1/models` | List available models |

These endpoints are fully OpenAI-compatible. Any client library that supports a custom `base_url` will work.

### Key Creation Response

When you create a key, the response includes ready-to-use configuration snippets:

```json
{
  "api_key": "sk-...",
  "key_id": "abc123",
  "key_alias": "my-key",
  "expires_at": null,
  "max_budget": null,
  "models": ["gpt-5.4-mini"],
  "config_snippets": {
    "curl": "curl https://llm-gateway.example.com/v1/chat/completions ...",
    "openai_python": "from openai import OpenAI\nclient = OpenAI(base_url=..., api_key=...)",
    "chatbox": { "id": "...", "name": "LLM Gateway", "type": "openai", "settings": { ... } },
    "claude_code": { "env": { "ANTHROPIC_BASE_URL": "...", "ANTHROPIC_AUTH_TOKEN": "...", ... } },
    "opencode": { "$schema": "https://opencode.ai/config.json", "provider": { ... }, "model": "..." }
  }
}
```

---

## Access Control Modes

Configured in `config/gateway.yaml` under `access_control.mode`:

### `allow_all`

Any authenticated user is granted access. Works with both CILogon and GitHub.

```yaml
access_control:
  mode: "allow_all"
```

### `domain` (CILogon only)

Only users whose email address ends with one of the listed domains are allowed. All others are rejected with a clear error message.

> **Note:** This mode requires `AUTH_PROVIDER=cilogon`. GitHub OAuth returns usernames, not email addresses, so `domain` mode is incompatible with GitHub.

```yaml
access_control:
  mode: "domain"
  allowed_domains:
    - "@example.org"
    - "@example.edu"
    - "@another.edu"
```

### `group` (CILogon only)

Only users who are members of specific CILogon groups (via the `isMemberOf` claim) are allowed. This requires your CILogon registration to include the `org.cilogon.userinfo` scope and group membership to be configured in your identity provider.

```yaml
access_control:
  mode: "group"
  allowed_groups:
    - "urn:mace:cilogon.org:group:my-llm-users"
```

### `github_users` (GitHub only)

Only the listed GitHub usernames are allowed. This is the simplest way to restrict access to a known set of people.

> **Note:** This mode requires `AUTH_PROVIDER=github`. Usernames are compared case-insensitively.

```yaml
access_control:
  mode: "github_users"
  allowed_github_users:
    - "alice"
    - "bob"
```

### `github_org` (GitHub only)

Only members of the specified GitHub organizations are allowed. Org membership is enforced by Vouch Proxy's built-in `team_whitelist` -- no backend code required.

> **Note:** This mode requires `AUTH_PROVIDER=github`. The `read:org` scope (included in the GitHub Vouch config) is required for org membership checks.

```yaml
access_control:
  mode: "github_org"
  allowed_github_orgs:
    - "my-github-org"
```

### Mode compatibility matrix

| Mode | CILogon | GitHub |
|------|---------|--------|
| `allow_all` | Yes | Yes |
| `domain` | Yes | No |
| `group` | Yes | No |
| `github_users` | No | Yes |
| `github_org` | No | Yes |

### Admin Users

Regardless of mode, admins have access to the admin dashboard at `/admin` and can see and delete any user's keys. The Admin tab only appears in the navbar for admin users. Use `admin_emails` for CILogon deployments and `admin_users` for GitHub deployments.

```yaml
access_control:
  # CILogon admins (matched by email)
  admin_emails:
    - "admin@example.org"
    - "pi@example.edu"

  # GitHub admins (matched by username)
  admin_users:
    - "github-admin-username"
```

---

## Token Policies

Configured in `config/gateway.yaml` under `tokens`:

| Setting | Default | Description |
|---------|---------|-------------|
| `max_keys_per_user` | 10 | Maximum number of active (non-expired, non-deleted) keys per user |
| `max_duration_days` | none (never expires) | Longest allowed key lifetime in days. Omit to allow non-expiring keys. |
| `default_max_budget` | none (unlimited) | Default USD spending cap per key. Omit for unlimited budget. Once a budget is set and exhausted, LiteLLM rejects further requests with that key. |

Example with limits enabled:

```yaml
tokens:
  max_keys_per_user: 10
  max_duration_days: 90
  default_max_budget: 50.0
```

---

## Frontend Pages

### `/` -- Landing Page (Public)

A public landing page visible to all visitors without authentication. Features:

- **Hero section:** Gateway logo, "LLM Gateway" heading, and tagline
- **Login button:** Shown when logged out. Clicking Login triggers the GitHub/CILogon auth flow and redirects to `/keys` after authentication.
- **"Go to Dashboard" button:** Shown when already logged in, links directly to `/keys`.
- **Feature cards:** Key Management, Multi-Model Access, Usage Tracking

### `/keys` -- API Key Management (Authenticated)

- **Create form:** key name (required), comment (optional), duration dropdown (Never/7/14/30/90 days -- default: Never), model multi-select with "Select All"
- **Post-creation display:** tabbed view with API Key, Chatbox config, Claude Code config, OpenCode config, curl command, and Python snippet. Each tab has copy-to-clipboard and download buttons.
- **Key listing table:** columns for name, key ID, spend, budget, created, expires, and a delete button with confirmation

### `/admin` -- Admin Dashboard (Admin only)

- **Summary cards:** total users, total spend, system status
- **Users table:** user ID, email, spend, max budget
- Only visible in the navbar for users listed in `admin_users` (GitHub) or `admin_emails` (CILogon)

### `/litellm/` -- LiteLLM Admin UI (Authenticated)

The LiteLLM built-in dashboard is exposed at `https://<your-FQDN>/litellm/` behind Vouch authentication. After logging in via your auth provider, you'll be prompted for the LiteLLM UI credentials (`LITELLM_UI_USERNAME` / `LITELLM_UI_PASSWORD` from `.env`). From this UI, admins can configure models, view usage, manage keys, and adjust LiteLLM settings directly.

---

## Security Model

| Layer | Protection |
|-------|-----------|
| **LiteLLM master key** | Never exposed to users. Only `gateway-api` communicates with LiteLLM's admin endpoints using the master key, and it runs on the internal `backend` network. |
| **Public landing page** | The root path (`/`) is unauthenticated, serving only the static landing page. No user data is exposed. |
| **Browser authentication** | Vouch Proxy + CILogon OIDC or GitHub OAuth. NGINX's `auth_request` directive validates every request to `/keys`, `/admin`, and `/api/v1/*` against Vouch before proxying. |
| **LLM API authentication** | `/v1/*` routes bypass Vouch and go directly to LiteLLM, which validates the user's virtual key. No cookie/OIDC needed for programmatic access. |
| **Access control** | Enforced at the `gateway-api` layer based on email domain, CILogon group membership, GitHub org membership, or allow-all. Configurable without code changes. |
| **Per-key budgets** | Optional. Enforced by LiteLLM when set. Once a key's spend reaches its `max_budget`, LiteLLM rejects further requests. |
| **Per-key model restrictions** | Enforced by LiteLLM. Keys can be restricted to specific models at creation time. |
| **Key expiration** | Optional. Enforced by LiteLLM when set. Keys automatically stop working after their expiration date. |
| **Key count limits** | Enforced by `gateway-api`. Users cannot exceed `max_keys_per_user` active keys. |
| **API key secrecy** | The full API key is shown once at creation time. Only hashed values are stored for audit. |
| **Network isolation** | Databases and Redis are on the `backend` network (Docker `internal: true`), unreachable from the internet. |
| **Secrets management** | All credentials in `.env`, excluded from version control via `.gitignore`. |

---

## Operations

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f litellm
docker compose logs -f gateway-api
docker compose logs -f nginx
```

### Restarting a Single Service

```bash
docker compose restart litellm
docker compose restart gateway-api
```

### Rebuilding After Code Changes

```bash
# Rebuild and restart the API backend
docker compose up -d --build gateway-api

# Rebuild and restart the frontend
docker compose up -d --build gateway-app
```

### Database Backups

```bash
# LiteLLM database (user/key/spend data)
docker compose exec litellm-db pg_dump -U litellm litellm > backup-litellm-$(date +%F).sql

# Gateway database (audit trail)
docker compose exec gateway-db pg_dump -U gateway gateway > backup-gateway-$(date +%F).sql
```

### Resetting Everything

```bash
docker compose down -v    # stops all containers and removes volumes
docker compose up -d --build
```

> **Warning:** `down -v` deletes all database data including user keys and spend history.

### Updating LiteLLM

```bash
docker compose pull litellm
docker compose up -d litellm
```

### Updating Vouch Proxy

```bash
docker compose pull vouch-proxy
docker compose up -d vouch-proxy
```

---

## Troubleshooting

### NGINX returns 502 Bad Gateway

One or more upstream services are not healthy. Check:

```bash
docker compose ps                    # look for unhealthy or restarting services
docker compose logs litellm          # LiteLLM often fails on bad config.yaml
docker compose logs gateway-api      # check for database connection errors
```

### Redirect loop on login

- Verify `GATEWAY_FQDN` in `.env` is correct
- Verify the OAuth provider callback URL matches `https://<FQDN>/auth`
- For CILogon: verify the CILogon client registration has the same callback URL
- For GitHub: verify the GitHub OAuth App has the same Authorization callback URL
- Check Vouch logs: `docker compose logs vouch-proxy`

### Landing page redirects to login instead of showing publicly

- Verify `publicAccess: false` in `vouch/config.yaml` (not `true`)
- Verify the NGINX config has `location = /` without `auth_request` before the catch-all `location /`
- Restart NGINX: `docker compose restart nginx`

### "Your GitHub username is not in the allowed users list"

Add the user's GitHub username to `config/gateway.yaml` under `allowed_github_users`, then restart gateway-api:

```bash
docker compose restart gateway-api
```

### "Your email domain is not authorized"

The user's email domain is not in `config/gateway.yaml` `allowed_domains`. Either add their domain or switch to `mode: "allow_all"`.

### LiteLLM won't start

- Check `litellm/config.yaml` for YAML syntax errors: `python3 -c "import yaml; yaml.safe_load(open('litellm/config.yaml'))"`
- Ensure the `DATABASE_URL` is correct -- LiteLLM needs PostgreSQL to be healthy first
- Check if the master key env var is set: `docker compose exec litellm env | grep LITELLM_MASTER_KEY`

### Key creation fails with "Maximum of 10 active keys allowed"

Delete unused keys from the `/keys` page or ask an admin to delete them from `/admin`.

### API key returns 401 from LiteLLM

- The key may have expired -- check the expiration date
- The key's budget may be exhausted -- check spend vs. budget in the UI
- The key may have been deleted
- Verify you're hitting `/v1/...` (not `/api/v1/...`, which requires browser auth)

### LiteLLM Admin UI (`/litellm/`) shows errors

- The LiteLLM UI credentials are `LITELLM_UI_USERNAME` and `LITELLM_UI_PASSWORD` from `.env`
- If you see "Unexpected token" errors, ensure the NGINX config includes the `location /litellm-asset-prefix/` and `location ~ ^/(v2|health|key|model|...)` blocks that proxy LiteLLM's API paths

### Self-hosted models not reachable

- Ensure the model container is on the `llm_backends` network: `docker network inspect llm_backends`
- Ensure `api_base` in `litellm/config.yaml` uses the container name, not `localhost`
- Test connectivity from the LiteLLM container: `docker compose exec litellm curl http://<model-container>:8000/v1/models`

### TLS certificate errors

- Verify the certificate matches your FQDN: `openssl x509 -in ssl/public.pem -noout -subject`
- Ensure `public.pem` includes the full chain (not just the leaf certificate)
- Check NGINX logs: `docker compose logs nginx`
