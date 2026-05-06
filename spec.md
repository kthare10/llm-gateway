# LLM Gateway — Technical Specification

Detailed technical reference for developers and operators. For setup and deployment instructions, see [README.md](README.md).

---

## Table of Contents

- [Directory Layout](#directory-layout)
- [Services Reference](#services-reference)
- [Networking](#networking)
- [Authentication Flow](#authentication-flow)
- [API Reference](#api-reference)
- [Access Control Modes](#access-control-modes)
- [Token Policies](#token-policies)
- [Frontend Pages](#frontend-pages)
- [Security Model](#security-model)

---

## Directory Layout

```
llm-gateway/
  docker-compose.yml              # All 8 services
  deploy.sh                       # Automated deployment script
  .env.example                    # Template -- committed to repo
  .env                            # Your secrets -- NOT committed
  LICENSE                         # Apache License 2.0
  README.md                       # Setup and deployment guide
  spec.md                         # This file -- technical specification
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
    "chatbox": { "id": "...", "name": "LLM Gateway", "type": "openai", "settings": { "..." } },
    "claude_code": { "env": { "ANTHROPIC_BASE_URL": "...", "ANTHROPIC_AUTH_TOKEN": "...", "..." } },
    "opencode": { "$schema": "https://opencode.ai/config.json", "provider": { "..." }, "model": "..." }
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
