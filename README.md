# LLM Gateway

A standalone, self-service platform for managing LLM API access. It places [LiteLLM](https://github.com/BerriAI/litellm) in front of any combination of LLM backends (Azure OpenAI, vLLM, Ollama, OpenAI, etc.), authenticates users via [CILogon](https://www.cilogon.org/) institutional OIDC or [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps), and lets each user create and manage their own API keys with optional per-key budgets, model restrictions, and expiration dates -- all without writing any application code.

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
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
- [Technical Specification](spec.md) (services, networking, auth flow, API reference, access control, security model)
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
| A container engine + compose | **Docker** Engine 24+ with Compose v2 (`docker compose version`), **or** **Podman** 4+ with a compose provider (`podman-compose` or `podman compose`). For Podman — especially rootless — see [PODMAN.md](PODMAN.md). |
| A server with a public FQDN | e.g. `llm-gateway.example.com` |
| TLS certificate + private key | Let's Encrypt, institutional CA, or self-signed for testing |
| An auth provider registration | CILogon OIDC (https://cilogon.org/oauth2/register) **or** GitHub OAuth App (https://github.com/settings/applications/new) |
| At least one LLM backend | Azure OpenAI key, OpenAI key, or a self-hosted vLLM/Ollama instance |

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

`deploy.sh` auto-detects Docker or Podman. To force one, set `CONTAINER_ENGINE=docker`
or `CONTAINER_ENGINE=podman`. **Podman users** (rootless in particular) should read
[PODMAN.md](PODMAN.md) first — it covers the compose-provider install and the
host prerequisites (subuid/subgid ranges, disk, privileged ports).

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
