# Running LLM Gateway with Podman

`deploy.sh` and `docker-compose.yml` work with **both Docker and Podman**. The
deploy script auto-detects the engine; the compose file is unchanged and is
consumed by either `docker compose` or `podman-compose`.

```bash
# Auto-detect (prefers docker if present, else podman):
bash deploy.sh

# Force an engine:
CONTAINER_ENGINE=podman bash deploy.sh
CONTAINER_ENGINE=docker bash deploy.sh
```

The script resolves a compose command in this order:

| Engine  | Compose command tried (first that works) |
|---------|-------------------------------------------|
| docker  | `docker compose` → `docker-compose`       |
| podman  | `podman-compose` → `podman compose`       |

All engine calls (`build`, `up`, `restart`, `ps`, `network create`) and the
health-wait go through this resolved command, so nothing else in the stack is
Docker-specific.

---

## 1. Install a compose provider for Podman

Podman itself does not ship a compose implementation. Install one (no root needed):

```bash
# podman-compose (pure Python, recommended, works fully rootless)
python3 -m ensurepip --user
python3 -m pip install --user podman-compose
export PATH="$HOME/.local/bin:$PATH"   # add to ~/.bashrc to persist
podman-compose --version
```

Alternatively, `podman compose` (the built-in subcommand) delegates to an
external provider — drop a Docker Compose v2 binary at
`~/.docker/cli-plugins/docker-compose` and it will be picked up.

---

## 2. Rootless prerequisites (the important part)

Rootless Podman needs a few things that a fresh account often lacks. Each fix
below requires **root once**; after that the stack runs entirely as your
unprivileged user.

### 2a. subuid / subgid ranges — **required**

Rootless Podman maps container UIDs/GIDs into a delegated range from
`/etc/subuid` and `/etc/subgid`. Without a range, Podman falls back to
"single mapping" and **cannot even unpack images** — extraction fails with:

```
potentially insufficient UIDs or GIDs available in user namespace
(requested 0:42 for /etc/shadow): ... lchown /etc/shadow: invalid argument
```

Check whether you have a range:

```bash
grep "^$(id -un):" /etc/subuid /etc/subgid || echo "NO RANGE — must be added by root"
```

Fix (run as root, once per user):

```bash
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$(id -un)"
# or append manually:
#   echo "$(id -un):100000:65536" | sudo tee -a /etc/subuid
#   echo "$(id -un):100000:65536" | sudo tee -a /etc/subgid
```

Then, as your user, re-initialize storage so the new mapping takes effect:

```bash
podman system migrate
```

### 2b. Disk space — **required**

The full stack pulls/builds a lot: `litellm` (~2 GB), two `postgres:15-alpine`
containers, `redis`, `nginx`, `vouch-proxy`, plus the custom `gateway-api`
(Python) and `gateway-app` (Next.js) build layers. Budget **~15–25 GB** of free
space at the rootless storage root (default `~/.local/share/containers`) and for
the named volumes.

Check:

```bash
podman info --format '{{.Store.GraphRoot}}'
df -h "$(podman info --format '{{.Store.GraphRoot}}')"
```

If your home partition is small, point Podman at a larger filesystem by setting
`graphroot` in `~/.config/containers/storage.conf`:

```ini
[storage]
driver = "overlay"
graphroot = "/path/to/large/fs/containers/storage"

[storage.options.overlay]
mount_program = "/usr/bin/fuse-overlayfs"
```

(Growing the home/LVM volume is the alternative — that's a root/sysadmin task.)

### 2c. Privileged ports 80/443 — only if you keep the default ports

Rootless processes cannot bind ports below 1024 unless the host allows it.
`nginx` in this stack listens on 80/443. Pick one:

- **Root sysctl** (keeps standard ports, rootless):
  ```bash
  echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-unprivileged-ports.conf
  sudo sysctl --system
  ```
- **Rootful podman**: run the deploy as root (`sudo`), which can bind 80/443 directly.
- **Remap to high ports**: change the `nginx` `ports:` in `docker-compose.yml` to
  e.g. `8080:80` / `8443:443` and reach the gateway at `https://host:8443`
  (put an external LB/firewall rule in front for 443 if needed).

---

## 3. Rootful Podman (simplest, if you have sudo)

If you can use `sudo`, running the whole stack rootful sidesteps 2a and 2c
entirely (root has full UID ranges and can bind 80/443):

```bash
sudo CONTAINER_ENGINE=podman bash deploy.sh
```

You still need adequate disk (2b) — rootful storage lives under
`/var/lib/containers`.

---

## 4. Notes / known differences vs Docker

- **`depends_on: condition: service_healthy`** — honored by podman-compose ≥ 1.x
  for ordering. `deploy.sh` additionally waits for each service's healthcheck to
  report `(healthy)` before declaring success, so startup ordering is robust
  either way.
- **Health-wait** uses `podman ps --filter name=… --format '{{.Status}}'` and
  looks for `(healthy)`, which is identical on Docker and Podman — no
  engine-specific inspect fields.
- **Fully-qualified image names** — `docker-compose.yml` pins the Docker Hub
  images as `docker.io/library/<name>` (nginx, redis, postgres). Podman enforces
  short-name resolution and, in a non-interactive run (no TTY), aborts with
  `short-name resolution enforced but cannot prompt without a TTY` for any
  unaliased short name. Fully-qualifying avoids that and is a no-op for Docker.
- **Vouch runs as container-root** (`user: "0:0"`) so it can read its
  bind-mounted `/config` regardless of the host umask. Its upstream image runs
  as uid 999, which cannot traverse a config dir created under a restrictive
  umask (e.g. `027` → `0750`); under rootless Podman "root" is the unprivileged
  runtime user, so this is safe and keeps the config non-world-readable.
- **External network** `llm_backends` is created by `deploy.sh` via
  `<engine> network create llm_backends` before compose runs.
- Attach self-hosted model containers to it with
  `podman network connect llm_backends <container>` (same as Docker).

---

## 5. Quick verification without deploying

You can validate the compose file parses under Podman without pulling images or
starting anything (needs neither disk nor subuids):

```bash
podman-compose -f docker-compose.yml config >/dev/null && echo "compose OK"
```

---

## 6. Optional: Let's Encrypt TLS with auto-renew (certbot)

`scripts/certbot-setup.sh` obtains and auto-renews a real certificate via the
**webroot** method (zero downtime). It relies on the ACME location already in
`nginx/default.conf` and the `./certbot-webroot` volume in `docker-compose.yml`.

Prerequisites: the stack is running, `GATEWAY_FQDN` in `.env` resolves publicly
to this host, and inbound TCP/80 is reachable from the internet.

```bash
# Docker (rootful):
sudo bash scripts/certbot-setup.sh --email you@example.org

# Rootless Podman under a dedicated service account (reloads nginx as that user):
sudo CONTAINER_ENGINE=podman PODMAN_USER=<svc-account> \
     bash scripts/certbot-setup.sh --email you@example.org

# Add --staging first to dry-run against Let's Encrypt staging (avoids rate limits).
```

The script installs certbot if missing, issues the cert, copies it into
`ssl/{fullchain,privkey}.pem` (what nginx mounts), reloads nginx, and installs a
renewal **deploy hook** at `/etc/letsencrypt/renewal-hooks/deploy/llm-gateway.sh`
so the system `certbot` timer re-copies the renewed cert and reloads nginx
automatically. It's entirely optional — skip it and drop your own certs into
`ssl/fullchain.pem` + `ssl/privkey.pem` instead.

**Why the cert is written in place.** `docker-compose.yml` bind-mounts the two
cert files individually (`./ssl/fullchain.pem:/etc/ssl/public.pem`). Podman
resolves a single-file bind mount to an *inode* at container start, so replacing
the file (`install`/`mv`, which allocates a new inode) leaves the running nginx
pinned to the old inode — `nginx -s reload` keeps serving the stale cert until
the container is restarted. Both the script and the generated deploy hook
therefore overwrite the cert files in place (`cat > file`) to preserve the
inode, so a plain reload picks up the new cert with zero downtime.

**Testing a renewal.** `certbot renew` inserts a random delay of up to ~8 minutes
before renewing (to spread load on Let's Encrypt), which makes an interactive
dry-run look like it has hung. Add `--no-random-sleep-on-renew` when testing:

```bash
sudo certbot renew --dry-run --no-random-sleep-on-renew
```
