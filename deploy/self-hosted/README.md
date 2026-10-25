# Self-hosted staging behind a Cloudflare Tunnel

Runs the app and Postgres on any Linux Docker host that already runs `cloudflared` (a Cloudflare Tunnel) in its own container on a shared Docker network. This stack does not include `cloudflared` and publishes no ports: the only way in is the tunnel.

Images come from `ghcr.io/<owner>/<repo>`; the `staging` tag is rebuilt on every push to `main` (`.github/workflows/staging.yml`). The host pulls, nothing in CI can reach it. Keep every site-specific value in `.env` on the host; this repository is public.

## 1. Prerequisites

- Docker with the compose and buildx plugins, and `cron` or any other scheduler.
- A running `cloudflared` container, and the name of the Docker network it is on (`docker inspect <container> --format '{{json .NetworkSettings.Networks}}'`).
- The GHCR package must be readable by the host: make it public (package settings, one-way), or run `docker login ghcr.io` on the host with a read-only token (`read:packages`) that you create.

## 2. Files and `.env`

Put the `deploy/` directory of this repository on the host (a `git clone` is simplest; `update.sh` calls `../deploy.sh`). Then:

```sh
cd deploy/self-hosted
cp .env.example .env && chmod 600 .env
```

Edit `.env`: `DOMAIN`, `TUNNEL_NETWORK`, the database password and `BETTER_AUTH_SECRET` (`openssl rand -hex 32` for each), and `SIGNUP_ALLOWLIST` (comma separated emails that may create an account; empty means open sign-up). `.env` never leaves the host, and is gitignored. Back it up somewhere private: losing the secret signs everyone out.

## 3. Tunnel public hostname

In the Cloudflare dashboard (Zero Trust, Networks, Tunnels, your tunnel, Public Hostname) add a hostname for `DOMAIN` with service `http://app:3000`. `app` resolves because the app container joins the tunnel's network. Cloudflare terminates TLS; the app trusts `cf-connecting-ip` for per-client rate limits only because nothing else can reach it.

## 4. First deploy

```sh
export REPO=<owner>/<repo>            # lowercase
digest=$(docker buildx imagetools inspect "ghcr.io/$REPO:staging" --format '{{.Manifest.Digest}}')
COMPOSE_FILE="$PWD/compose.yaml" sh ../deploy.sh "ghcr.io/$REPO@$digest"
```

`deploy.sh` pulls, dumps the database if one is running, applies migrations, brings the stack up and waits for health checks. If bring-up fails it restores the previous image. It records `IMAGE_REF` and `PREVIOUS_IMAGE_REF` in `.env`. Then open `https://<DOMAIN>/healthz`.

## 5. Automatic updates

Schedule `update.sh` every few minutes (cron, or any scheduler on the host):

```sh
*/5 * * * * REPO=<owner>/<repo> sh /path/to/deploy/self-hosted/update.sh >> /path/to/update.log 2>&1
```

It resolves the digest of `ghcr.io/$REPO:staging`, exits silently when that is already deployed, otherwise runs `deploy.sh` with `repo@digest`. A lock stops runs overlapping. It logs timestamps and digests only. To pin staging to an older build, stop the schedule and run `deploy.sh` by hand with that digest.

## 6. Backups

`deploy.sh` keeps the newest 5 pre-migration dumps in `deploy/self-hosted/backups/` (same disk as the database, so this only guards bad migrations). For a real backup schedule something like this and copy the file off the host:

```sh
cd /path/to/deploy/self-hosted
docker compose exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "backup-$(date -u +%Y%m%d).dump"
```

Restore into an empty database with `pg_restore`. Database files live in the named volume `pgdata`.

## 7. Logs and status

```sh
cd /path/to/deploy/self-hosted
docker compose ps
docker compose logs --follow app
docker compose logs --follow db
```

The app logs request failures with secrets stripped; `update.log` (above) shows deploy history.
