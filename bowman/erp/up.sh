#!/usr/bin/env bash
# Start, stop or inspect Bowman's ERPNext on the home-server Mac.
#
#   bowman/erp/up.sh            copy compose.yml to the Mac and start the stack (idempotent)
#   bowman/erp/up.sh stop       stop the containers; volumes (all ERP data) are kept
#   bowman/erp/up.sh status     show container state and ping the site
#   bowman/erp/up.sh tunnel     open the SSH tunnel laptop:8081 -> Mac:8081 (foreground)
#
# Reads the repo-root .env (override with ENV_FILE=...). Needed there:
#   BOWMAN_ERP_SSH             user@host of the Mac, for ssh. Kept out of the repo on purpose.
#   ERPNEXT_ADMIN_PASSWORD     generated and written to .env if empty
# The MariaDB root password is generated on the Mac (~/bowman/erp/.env, mode 600) and never
# leaves it. Secrets travel over ssh stdin, never on a command line, and are never printed.
#
# Deliberately absent: a "wipe" command. Deleting the volumes destroys the seeded data and
# needs Tyler's OK (CLAUDE.md).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/../../.env}"
REMOTE_DIR='~/bowman/erp'
PROJECT=bowman-erp
PORT=8081
# Colima's docker and compose live in Homebrew paths that a non-interactive ssh shell lacks.
REMOTE_PATH='export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH'
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)

envget() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }

# Set KEY to a fresh random value in .env unless it already has one. Prints nothing.
ensure_secret() {
  local key="$1"
  [ -n "$(envget "$key")" ] && return 0
  local val
  val="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)"
  if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"   # .env.* is gitignored
    grep -v "^$key=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

SSH_TARGET="$(envget BOWMAN_ERP_SSH)"
[ -n "$SSH_TARGET" ] || { echo "BOWMAN_ERP_SSH is not set in $ENV_FILE (user@host of the Mac)" >&2; exit 1; }
rssh() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }

cmd="${1:-up}"
case "$cmd" in
  up)
    ensure_secret ERPNEXT_ADMIN_PASSWORD
    rssh "mkdir -p $REMOTE_DIR"
    rssh "cat > $REMOTE_DIR/compose.yml" < "$HERE/compose.yml"
    # Remote .env: Administrator password from the laptop (via stdin), DB root password kept
    # if one exists on the Mac, generated there otherwise.
    envget ERPNEXT_ADMIN_PASSWORD | rssh "
      set -e; umask 077; cd $REMOTE_DIR
      read -r admin
      db=\$(grep '^BOWMAN_ERP_DB_ROOT_PASSWORD=' .env 2>/dev/null | cut -d= -f2- || true)
      [ -n \"\$db\" ] || db=\$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)
      printf 'ERPNEXT_ADMIN_PASSWORD=%s\nBOWMAN_ERP_DB_ROOT_PASSWORD=%s\n' \"\$admin\" \"\$db\" > .env.new
      mv .env.new .env"
    rssh "$REMOTE_PATH; cd $REMOTE_DIR && docker compose -p $PROJECT up -d --quiet-pull"
    echo "Waiting for the site (first start installs ERPNext, about 3-8 minutes)..."
    for _ in $(seq 1 120); do
      # Ready = the one-shot create-site container exited 0 (site exists, ERPNext installed)
      # and the web tier answers a ping.
      state="$(rssh "$REMOTE_PATH; cd $REMOTE_DIR && docker inspect -f '{{.State.Status}}:{{.State.ExitCode}}' \$(docker compose -p $PROJECT ps -aq create-site)" 2>/dev/null || true)"
      if [ "$state" = "exited:0" ] && [ "$(rssh "curl -s -m 5 http://127.0.0.1:$PORT/api/method/ping" 2>/dev/null)" = '{"message":"pong"}' ]; then
        echo "Up. Open the tunnel with: $0 tunnel   then browse http://127.0.0.1:$PORT"
        exit 0
      fi
      case "$state" in
        exited:0|"") ;;
        exited:*) echo "create-site failed ($state). Check: docker logs bowman-erp-create-site-1 on the Mac." >&2; exit 1 ;;
      esac
      sleep 10
    done
    echo "Site did not answer within 20 minutes. Check: $0 status, then docker logs on the Mac." >&2
    exit 1
    ;;
  stop)
    rssh "$REMOTE_PATH; cd $REMOTE_DIR && docker compose -p $PROJECT stop"
    ;;
  status)
    rssh "$REMOTE_PATH; cd $REMOTE_DIR && docker compose -p $PROJECT ps; curl -s -m 5 http://127.0.0.1:$PORT/api/method/ping; echo"
    ;;
  tunnel)
    echo "Tunnel 127.0.0.1:$PORT -> Mac:$PORT. Ctrl-C to close."
    exec ssh "${SSH_OPTS[@]}" -N -L "$PORT:127.0.0.1:$PORT" "$SSH_TARGET"
    ;;
  *)
    echo "usage: $0 [up|stop|status|tunnel]" >&2
    exit 2
    ;;
esac
