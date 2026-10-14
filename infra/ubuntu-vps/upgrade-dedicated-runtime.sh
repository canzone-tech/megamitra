#!/usr/bin/env bash
# Repeat deployment for an already-running MegaGoldenClub (never first bootstrap).
# Scope: three dedicated service-user PM2 apps, and the 'current' symlink only.
set -euo pipefail
set +x
umask 077
if [[ "$EUID" -ne 0 || "$#" -ne 4 || "$1" != '--activate' ||
      ! "$2" =~ ^[a-f0-9]{40}$ || ! "$3" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'STOP: root-only usage: upgrade-dedicated-runtime.sh --activate OLD_SHA NEW_SHA REVIEWED_ECOSYSTEM' >&2
  exit 1
fi
OLD_SHA="$2"
NEW_SHA="$3"
REVIEWED="$4"
if [[ "$OLD_SHA" == "$NEW_SHA" || "${MEGAGOLDENCLUB_TECHNICAL_DEPLOY_APPROVED:-}" != 'YES' ]]; then
  echo 'STOP: distinct release and explicit technical deployment approval required' >&2
  exit 1
fi
BASE='/opt/megagoldenclub'
CURRENT="$BASE/current"
OLD="$BASE/releases/$OLD_SHA"
NEW="$BASE/releases/$NEW_SHA"
ROOT='/etc/megagoldenclub'
MANIFEST="$ROOT/ecosystem.config.cjs"
SERVICE='megagoldenclub'
SERVICE_HOME='/var/lib/megagoldenclub'
PM2_HOME_DIR="$SERVICE_HOME/.pm2-runtime"
PM2_BIN="$(command -v pm2 || true)"
NAMES=(megagoldenclub-api megagoldenclub-admin megagoldenclub-member)
LINK_TMP="$BASE/.pending-current-$$"
SWITCHED=0
COMPLETED=0

# Dedicated lock; no global PM2/Apache operations.
exec 9>/run/lock/megagoldenclub-release.lock
flock -n 9 || { echo 'STOP: MegaGoldenClub release operation already running' >&2; exit 1; }
pm2_isolated() {
  (
    cd "$SERVICE_HOME"
    runuser -u "$SERVICE" -- env "HOME=$SERVICE_HOME" "PM2_HOME=$PM2_HOME_DIR" "$PM2_BIN" "$@"
  )
}
check_release() {
  local sha="$1" dir="$2" file
  [[ -d "$dir" && ! -L "$dir" && -f "$dir/RELEASE_SHA" &&
     ! -L "$dir/RELEASE_SHA" && "$(<"$dir/RELEASE_SHA")" == "$sha" &&
     -f "$dir/api/dist/main.js" && -f "$dir/admin/server.js" &&
     -f "$dir/member/server.js" ]] || return 1
  for file in api/dist/main.js admin/server.js member/server.js; do
    runuser -u "$SERVICE" -- test -r "$dir/$file" || return 1
  done
}
check_processes() {
  pm2_isolated jlist | /usr/bin/node -e '
    let input="";
    process.stdin.on("data", chunk=>input+=chunk);
    process.stdin.on("end", ()=>{
      try {
        const rows=JSON.parse(input);
        const expected=["megagoldenclub-api","megagoldenclub-admin","megagoldenclub-member"].sort();
        if (!Array.isArray(rows) || rows.length!==3 ||
          JSON.stringify(rows.map(x=>x.name).sort())!==JSON.stringify(expected) ||
          rows.some(x=>x.pm2_env?.status!=="online")) process.exit(1);
      } catch { process.exit(1); }
    });
  '
}
check_health() {
  local body code port good
  good=0
  for _ in $(seq 1 70); do
    if body="$(curl --silent --fail --max-time 3 http://127.0.0.1:3200/health/ready 2>/dev/null)" &&
      printf '%s' "$body" | /usr/bin/node -e '
        let s="";process.stdin.on("data",x=>s+=x);
        process.stdin.on("end",()=>{try {
          const j=JSON.parse(s);
          process.exit(j.status==="ok" && ["mysql","mongodb","redis"].every(k=>j.services?.[k]==="up")?0:1);
        } catch { process.exit(1); }});
      '; then good=1; break; fi
    sleep 1
  done
  [[ "$good" == 1 ]] || return 1
  for port in 3201 3202; do
    good=0
    for _ in $(seq 1 40); do
      code="$(curl --silent --max-time 3 --output /dev/null \
        --write-out '%{http_code}' "http://127.0.0.1:$port/" || true)"
      if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then good=1; break; fi
      sleep 1
    done
    [[ "$good" == 1 ]] || return 1
  done
  for port in 3200 3201 3202; do
    ss -ltnH "( sport = :$port )" | grep -q '127.0.0.1:' || return 1
  done
}
atomic_switch() {
  local expected="$1" target="$2"
  [[ -L "$CURRENT" && "$(readlink "$CURRENT")" == "$expected" &&
     ! -e "$LINK_TMP" && ! -L "$LINK_TMP" ]] || return 1
  ln -s "$target" "$LINK_TMP"
  if [[ "$(readlink "$CURRENT")" != "$expected" ]]; then
    rm -f -- "$LINK_TMP"
    return 1
  fi
  mv -Tf -- "$LINK_TMP" "$CURRENT"
}
restart_dedicated_only() {
  local name
  for name in "${NAMES[@]}"; do pm2_isolated delete "$name" >/dev/null; done
  pm2_isolated start "$MANIFEST" >/dev/null
}
rollback() {
  local original_status="$?"
  trap - EXIT
  rm -f -- "$LINK_TMP"
  if [[ "$SWITCHED" == 1 && "$COMPLETED" != 1 ]]; then
    echo 'RELEASE FAILURE: restoring only previous MegaGoldenClub runtime' >&2
    if [[ -L "$CURRENT" && "$(readlink "$CURRENT")" == "$NEW" ]]; then
      atomic_switch "$NEW" "$OLD" || {
        echo 'CRITICAL: release symlink rollback failed; operator intervention required' >&2
        exit 1
      }
    fi
    for name in "${NAMES[@]}"; do
      pm2_isolated delete "$name" >/dev/null 2>&1 || true
    done
    if pm2_isolated start "$MANIFEST" >/dev/null &&
       check_health && check_processes && pm2_isolated save >/dev/null; then
      echo "ROLLBACK VERIFIED: $OLD_SHA" >&2
    else
      echo 'CRITICAL: previous release not healthy; dedicated service needs investigation' >&2
    fi
  fi
  exit "$original_status"
}
trap rollback EXIT

echo '==> Checking exact previous release, dedicated PM2 and reviewed operations manifest'
[[ -n "$PM2_BIN" && -x "$PM2_BIN" && -f "$REVIEWED" && ! -L "$REVIEWED" &&
   -f "$MANIFEST" && ! -L "$MANIFEST" && -L "$CURRENT" &&
   "$(readlink "$CURRENT")" == "$OLD" ]] || {
  echo 'STOP: current symlink, PM2 or manifest differs from approved state' >&2; exit 1;
}
[[ "$(stat -c '%u:%g:%a' "$MANIFEST")" == '0:0:644' &&
   "$(stat -c '%U:%G:%a' "$ROOT")" == 'root:megagoldenclub:750' &&
   "$(stat -c '%U:%G:%a' "$ROOT/api.env")" == 'root:megagoldenclub:640' &&
   ! -L "$PM2_HOME_DIR" && -d "$PM2_HOME_DIR" ]] || {
  echo 'STOP: dedicated configuration or PM2_HOME permissions invalid' >&2; exit 1;
}
cmp -s -- "$MANIFEST" "$REVIEWED" || {
  echo 'STOP: installed PM2 manifest differs from reviewed repo manifest' >&2; exit 1;
}
[[ "$(/usr/bin/node -p 'process.versions.node.split(".")[0]')" == 24 ]] || exit 1
/usr/bin/node --check "$MANIFEST"
check_release "$OLD_SHA" "$OLD"
check_release "$NEW_SHA" "$NEW"
check_processes
check_health
echo "PRE-DEPLOY HEALTH: PASS ($OLD_SHA)"

echo '==> Switching exact compiled runtime; restarting dedicated apps only'
atomic_switch "$OLD" "$NEW"
SWITCHED=1
restart_dedicated_only
check_health
check_processes
[[ "$(readlink "$CURRENT")" == "$NEW" ]] || exit 1
pm2_isolated save >/dev/null
COMPLETED=1
echo "MEGAGOLDENCLUB TECHNICAL RELEASE: PASS ($NEW_SHA)"
echo 'Finance/payout HOLD remains; recovery/business approvals are separate'
