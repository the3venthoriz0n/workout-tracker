# Self-hosted staging behind a Cloudflare Tunnel

Runs the app and Postgres on any Linux Docker host that already runs `cloudflared` (a Cloudflare Tunnel) in its own container. This stack does not include `cloudflared`; the only way in is the tunnel. The app is published on `127.0.0.1` only (never the LAN), for a `cloudflared` with host networking.

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

Edit `.env`: `DOMAIN`, `TUNNEL_NETWORK`, the database password and `BETTER_AUTH_SECRET` (`openssl rand -hex 32` for each), `SIGNUP_ALLOWLIST` (comma separated emails that may create an account; the line is required, and an explicitly empty value means open sign-up; compose refuses to start when it is missing), and `RESEND_API_KEY` and `MAIL_FROM` (set-up and password-reset email through Resend; sign-in needs a confirmed email, so both are required and compose refuses to start without them; use a sending-only API key and a sender on a domain verified in Resend). `.env` never leaves the host, and is gitignored. Back it up somewhere private: losing the secret signs everyone out.

## 3. Tunnel public hostname

Two ways to connect the tunnel, depending on how your `cloudflared` container is networked:

- **Shared Docker network** (cloudflared on a bridge/custom network): service `http://workout-tracker-app:3000`, and `TUNNEL_NETWORK` is that network's name.
- **Host network mode** (cloudflared's network type is `host`; it cannot join Docker networks or resolve container names): service `http://127.0.0.1:18080` (or your `APP_HOST_PORT`). For `TUNNEL_NETWORK` use any empty network you create once, e.g. `docker network create workout-tunnel` (compose needs one to exist; nothing else uses it).


In the Cloudflare dashboard (Zero Trust, Networks, Tunnels, your tunnel, Public Hostname) add a hostname for `DOMAIN` with service `http://workout-tracker-app:3000`. That name is a network alias the app container gets on the tunnel's network; use it instead of `app`, which any other stack on that network could also claim. Cloudflare terminates TLS; the app trusts `cf-connecting-ip` for per-client rate limits only because nothing else can reach it.

Known limits (also in the spec):
- Any other container on the tunnel network can reach the app directly and send its own `cf-connecting-ip`, bypassing per-IP rate limits. Put only trusted containers on that network.
- The allowlist checks an email address, not a person, so anyone who knows a listed address can register it before its owner does. That gains nothing: the password is chosen only through the set-up link mailed to the address, and using it verifies the address and signs everyone else out.

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

It resolves the digest of `ghcr.io/$REPO:staging`, exits silently when that is already deployed, otherwise runs `deploy.sh` with `repo@digest`. A lock (`flock`, or a lock directory where `flock` is missing) stops runs overlapping. It logs timestamps and digests only.

If a deploy fails, `update.sh` writes the digest to `.failed-digest` next to `.env` and does not retry it on later runs (it logs one reminder line and exits 0). It deploys again when a different digest is published, or after you delete `.failed-digest`. Fix the cause first: a retry would take another pre-migration dump. To pin staging to an older build, stop the schedule and run `deploy.sh` by hand with that digest.

## 6. Backups

`deploy.sh` keeps the newest 5 pre-migration dumps in `deploy/self-hosted/backups/` (same disk as the database, so this only guards bad migrations). When a deploy fails, that attempt's dump is renamed to `pre-<time>-<digest>.dump.keep` (the name is logged) and is never rotated, so repeated failures cannot delete the last good copy. To restore it, create an empty database and run `pg_restore` on it (for example `docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backups/<file>.keep`). Delete `*.keep` files by hand once they are no longer needed. For a real backup schedule something like this and copy the file off the host:

```sh
cd /path/to/deploy/self-hosted
docker compose exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "backup-$(date -u +%Y%m%d).dump"
```

Restore into an empty database with `pg_restore`. After a deploy, `update.sh`/`deploy.sh` remove only this app's older images (same repository, other digests); other stacks' images are never touched. Database files live in the named volume `pgdata`.

## 7. Logs and status

```sh
cd /path/to/deploy/self-hosted
docker compose ps
docker compose logs --follow app
docker compose logs --follow db
```

The app logs request failures with secrets stripped; `update.log` (above) shows deploy history.
