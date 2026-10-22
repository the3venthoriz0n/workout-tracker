# Local development. Needs only Docker and just; Node and pnpm run inside containers.
# CI builds and deploys; nothing here touches production.

# Always use the local Docker engine (bind mounts need it), even if another context is active.
# Override with WORKOUT_DOCKER_CONTEXT=<name>.
export DOCKER_CONTEXT := env("WORKOUT_DOCKER_CONTEXT", "default")

# Run dev containers as you, so files they create (node_modules, migrations) are yours.
export DEV_UID := `id -u`
export DEV_GID := `id -g`

# List recipes
default:
    @just --list

# Create .env with random local secrets (no-op if it exists)
setup:
    #!/usr/bin/env sh
    set -eu
    if [ -f .env ]; then exit 0; fi
    sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" \
        -e "s/^BETTER_AUTH_SECRET=.*/BETTER_AUTH_SECRET=$(openssl rand -hex 32)/" \
        .env.example > .env
    chmod 600 .env
    echo "Created .env with random local secrets."

# Start Postgres, API (:3000) and web (http://localhost:5173) with hot reload
dev: setup
    docker compose up --build

# Stop everything (data is kept)
down:
    docker compose --profile preview down

# Follow logs (optionally for one service: db, dev)
logs *service:
    docker compose logs --follow {{service}}

# Run any pnpm command in the dev container, e.g. `just pnpm --filter @workout/api add zod`
pnpm *args: setup
    docker compose run --rm --no-deps dev pnpm {{args}}

# Install dependencies (after pulling changes to the lockfile)
install: (pnpm "install --frozen-lockfile")

# Typecheck, test and build: the same checks CI runs
check: (pnpm "install --frozen-lockfile") (pnpm "typecheck") (pnpm "test") (pnpm "build")

test: (pnpm "test")

typecheck: (pnpm "typecheck")

# Generate a migration from the Drizzle schema
db-generate: (pnpm "--filter @workout/api db:generate")

# Apply migrations to the local database
db-migrate: setup
    docker compose run --rm dev pnpm --filter @workout/api db:migrate

# Open psql on the local database
psql: setup
    docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Delete the local database and start fresh
db-reset: setup
    docker compose rm --stop --force db
    docker volume rm --force workout-tracker_pgdata
    docker compose up --detach --wait db

# How to open the dev app from this PC and from a phone on the same Wi-Fi (WSL2 on Windows)
lan:
    #!/usr/bin/env bash
    set -euo pipefail
    port=5173
    wsl_ip=$(ip -4 -o addr show eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)
    if ! command -v powershell.exe >/dev/null 2>&1 || [ -z "$wsl_ip" ]; then
      echo "Not WSL2. Open http://<this machine's LAN IP>:$port from a phone on the same Wi-Fi,"
      echo "and allow inbound TCP $port from the local subnet in the firewall."
      exit 0
    fi
    win_ip=$(powershell.exe -NoProfile -Command '(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1).IPv4Address.IPAddress' | tr -d '\r')
    probe() { curl -s -o /dev/null --max-time 3 -w '%{http_code}' "$1" || true; }
    echo "This PC:    http://localhost:$port"
    echo "Phone/LAN:  http://$win_ip:$port   (same Wi-Fi; dev only, nothing here touches production)"
    echo
    echo "Dev server from WSL ($wsl_ip): $(probe "http://$wsl_ip:$port/")  (200 = up; start it with 'just dev')"
    echo "Via the Windows LAN address:  $(powershell.exe -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 http://$win_ip:$port/).StatusCode } catch { 'unreachable' }" | tr -d '\r')"
    echo
    echo "WSL2 has its own network, so Windows must forward the port. Run in an ADMIN PowerShell."
    echo "Redo the first two after every WSL restart (the WSL address changes; the delete may say 'not found'):"
    echo
    echo "  netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port"
    echo "  netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$port connectaddress=$wsl_ip connectport=$port"
    echo
    echo "Once, to let other devices on your own network (not the internet) reach it:"
    echo
    echo "  New-NetFirewallRule -DisplayName \"workout dev $port\" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Any -RemoteAddress LocalSubnet"
    echo
    echo "Undo:"
    echo "  netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port"
    echo "  Remove-NetFirewallRule -DisplayName \"workout dev $port\""
    echo "Loopback only: DEV_BIND=127.0.0.1 just dev"

# Build the production image and run it locally on http://localhost:8080
preview: setup
    docker compose --profile preview build preview
    docker compose --profile preview run --rm preview node migrate.js
    docker compose --profile preview up preview

# Remove containers, volumes, node_modules and build output
clean:
    docker compose --profile preview down --volumes --remove-orphans
    rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/*/dist

# --- Infrastructure (DigitalOcean via Terraform) ------------------------------
# Needs DIGITALOCEAN_TOKEN in your environment, never in a file. Load it without
# leaving it in shell history:  read -rs DIGITALOCEAN_TOKEN && export DIGITALOCEAN_TOKEN

admin_key := env("WORKOUT_ADMIN_SSH_KEY", env("HOME") / ".ssh/id_ed25519.pub")
deploy_key := env("HOME") / ".ssh/workout-tracker-deploy"
terraform_image := "hashicorp/terraform:1.17.0@sha256:4d1b496a256f2989bccdb04b9104a4ede97234b10fba90259e173e905ec4fb58"

# Create CI's deploy SSH key pair in ~/.ssh (outside the repo; no-op if it exists)
deploy-key:
    #!/usr/bin/env sh
    set -eu
    if [ -f "{{deploy_key}}" ]; then exit 0; fi
    ssh-keygen -t ed25519 -N "" -C "workout-tracker-deploy" -f "{{deploy_key}}" >/dev/null
    echo "Created {{deploy_key}} (private) and .pub"

# Run terraform in a pinned container, e.g. `just tf state list`
tf *args: deploy-key
    #!/usr/bin/env sh
    set -eu
    TF_VAR_admin_ssh_public_key="$(cat "{{admin_key}}")" \
    TF_VAR_deploy_ssh_public_key="$(cat "{{deploy_key}}.pub")" \
    docker run --rm -it \
      --user "$DEV_UID:$DEV_GID" -e HOME=/tmp \
      -e DIGITALOCEAN_TOKEN -e TF_VAR_admin_ssh_public_key -e TF_VAR_deploy_ssh_public_key \
      -v "$PWD/infra/terraform:/work" -w /work \
      {{terraform_image}} {{args}}

# Show what would change on DigitalOcean
infra-plan: _require-token (tf "init -input=false") (tf "plan")

# Create or update the Droplet, firewall and reserved IP (safe to re-run)
infra-apply: _require-token (tf "init -input=false") (tf "apply")

# Wait for first-boot setup to finish on the Droplet
server-wait:
    ssh -o StrictHostKeyChecking=accept-new "admin@$(just tf output -raw ip | tr -d '\r')" 'cloud-init status --wait && docker --version'

# Create the GitHub 'production' environment (v* tags only) with deploy key, host and domain
github-setup domain:
    #!/usr/bin/env bash
    set -euo pipefail
    repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
    ip=$(just tf output -raw ip | tr -d '\r')
    # Note: re-running this PUT can reset settings made in the GitHub UI (reviewers, wait timer,
    # branch policies). Verify required reviewers and the v* tag policy afterwards
    # (see docs/release-checklist.md).
    gh api --method PUT "repos/$repo/environments/production" --input - >/dev/null <<'EOF'
    {"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
    EOF
    # Ignore only HTTP 422 "already exists"; any other failure stops here.
    if ! out=$(gh api --method POST "repos/$repo/environments/production/deployment-branch-policies" \
      -f name='v*' -f type=tag 2>&1); then
      case "$out" in
        *"HTTP 422"*) echo "Tag policy v* already exists." ;;
        *) echo "$out" >&2; exit 1 ;;
      esac
    fi
    # Values go in on stdin, so they never appear in process lists or shell history.
    gh secret set DEPLOY_SSH_KEY --env production < "{{deploy_key}}"
    printf '%s' "$ip" | gh secret set DEPLOY_HOST --env production
    ssh-keyscan -t ed25519 "$ip" 2>/dev/null | gh secret set DEPLOY_KNOWN_HOSTS --env production
    gh variable set DOMAIN --env production --body "{{domain}}"
    echo "Production environment configured for $repo -> $ip ({{domain}})."

_require-token:
    @[ -n "${DIGITALOCEAN_TOKEN:-}" ] || { echo "Set DIGITALOCEAN_TOKEN first: read -rs DIGITALOCEAN_TOKEN && export DIGITALOCEAN_TOKEN"; exit 1; }
