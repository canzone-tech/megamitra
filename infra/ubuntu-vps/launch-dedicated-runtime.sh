#!/usr/bin/env bash
# First source-free deployment, isolated from existing Apache/root PM2.
set -euo pipefail
set +x
umask 077

if [[ "$EUID" -ne 0 || "$#" -ne 2 || ! "$1" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'STOP: root-only: launch-dedicated-runtime.sh RELEASE_SHA OPS_MANIFEST' >&2
  exit 1
fi
SHA="$1"
OPS="$2"
BASE='/opt/megagoldenclub'
RELEASE="$BASE/releases/$SHA"
CURRENT="$BASE/current"
ROOT='/etc/megagoldenclub'
ECOSYSTEM="$ROOT/ecosystem.config.cjs"
HOME_DIR='/var/lib/megagoldenclub'
PM2_HOME_DIR="$HOME_DIR/.pm2"
PM2_BIN="$(command -v pm2 || true)"
SERVICE='megagoldenclub'
STARTED=0
LINKED=0
SUCCESS=0

pm2_isolated() {
  runuser -u "$SERVICE" -- env "HOME=$HOME_DIR" "PM2_HOME=$PM2_HOME_DIR" "$PM2_BIN" "$@"
}
cleanup() {
  if [[ "$SUCCESS" != 1 ]]; then
    if [[ "$STARTED" == 1 ]]; then
      for name in megagoldenclub-api megagoldenclub-admin megagoldenclub-member; do
        pm2_isolated delete "$name" >/dev/null 2>&1 || true
      done
    fi
    if [[ "$LINKED" == 1 && -L "$CURRENT" && "$(readlink "$CURRENT")" == "$RELEASE" ]]; then
      rm -f -- "$CURRENT"
    fi
    if [[ "$STARTED" == 1 || "$LINKED" == 1 ]]; then
      echo 'DEPLOYMENT NOT VERIFIED; only dedicated release/PM2 state was rolled back' >&2
    else
      echo 'FIRST-LAUNCH PREFLIGHT STOP: no service started or modified' >&2
    fi
  fi
}
trap cleanup EXIT

echo '=== VERIFY FIRST LAUNCH BOUNDARIES ==='
if [[ -z "$PM2_BIN" || ! -x "$PM2_BIN" || ! -f "$OPS" || -L "$OPS" ]]; then
  echo 'STOP: PM2 or reviewed ops manifest unavailable' >&2; exit 1
fi
if [[ ! -d "$RELEASE" || -L "$RELEASE" || ! -f "$RELEASE/RELEASE_SHA" ||
      "$(<"$RELEASE/RELEASE_SHA")" != "$SHA" ||
      ! -f "$RELEASE/api/dist/main.js" ||
      ! -f "$RELEASE/admin/server.js" ||
      ! -f "$RELEASE/member/server.js" ]]; then
  echo 'STOP: expected immutable compiled release missing' >&2; exit 1
fi
if [[ -e "$CURRENT" || -L "$CURRENT" ]]; then
  echo 'STOP: current release already exists; first launch refuses overwrite' >&2
  exit 1
fi
# Prior failed first launch may have installed only this reviewed ops file.
# Reuse it ONLY when root-owned, not a symlink, mode 0644, and byte-for-byte
# identical to this exact reviewed GitHub manifest. Never silently overwrite.
# The pure verifier is tested on isolated fixture files in Backend CI.
verify_existing_ecosystem() {
  local existing="$1" reviewed="$2" uid="$3" gid="$4"
  if [[ -L "$existing" || ! -f "$existing" ]]; then
    echo 'STOP: existing PM2 manifest is not a regular non-symlink file' >&2
    return 1
  fi
  if [[ "$(stat -c '%u:%g:%a' -- "$existing")" != "$uid:$gid:644" ]]; then
    echo 'STOP: existing PM2 manifest has unexpected ownership or permissions' >&2
    return 1
  fi
  if ! cmp -s -- "$existing" "$reviewed"; then
    echo 'STOP: existing PM2 manifest differs from pinned reviewed version' >&2
    return 1
  fi
}
ECOSYSTEM_PRESENT=0
if [[ -e "$ECOSYSTEM" || -L "$ECOSYSTEM" ]]; then
  verify_existing_ecosystem "$ECOSYSTEM" "$OPS" 0 0
  ECOSYSTEM_PRESENT=1
  echo 'Existing protected PM2 manifest: IDENTICAL / REUSABLE'
fi

# The dedicated Unix user may have an existing home created by useradd.
# Treat that as normal only if it belongs to the dedicated identity, is not
# writable by others and has no pre-existing PM2 process state.
# Keep this pure function independently regression-tested on disposable CI dirs.
verify_pristine_pm2_home() {
  local home="$1" pm2_home="$2" uid="$3" gid="$4"
  local attrs mode
  if [[ -e "$home" || -L "$home" ]]; then
    if [[ -L "$home" || ! -d "$home" ]]; then
      echo 'STOP: dedicated service home is a symlink or not a directory' >&2
      return 1
    fi
    attrs="$(stat -c '%u:%g:%a' -- "$home")"
    if [[ "${attrs%%:*}" != "$uid" || "${attrs#*:}" != "$gid:"* ]]; then
      echo 'STOP: dedicated home belongs to an unexpected Unix identity' >&2
      return 1
    fi
    mode="${attrs##*:}"
    if (( (8#$mode & 0022) != 0 )); then
      echo 'STOP: dedicated service home is writable by group/others' >&2
      return 1
    fi
  fi
  if [[ -e "$pm2_home" || -L "$pm2_home" ]]; then
    if [[ -L "$pm2_home" || ! -d "$pm2_home" ]]; then
      echo 'STOP: dedicated PM2_HOME is not a real directory' >&2
      return 1
    fi
    if [[ "$(stat -c '%u:%g:%a' -- "$pm2_home")" != "$uid:$gid:700" ]]; then
      echo 'STOP: dedicated PM2_HOME has unexpected ownership/permissions' >&2
      return 1
    fi
    if [[ -n "$(find "$pm2_home" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      echo 'STOP: existing PM2_HOME state found; refusing to touch PM2 processes' >&2
      return 1
    fi
  fi
}
SERVICE_UID="$(id -u "$SERVICE")"
SERVICE_GID="$(id -g "$SERVICE")"
verify_pristine_pm2_home "$HOME_DIR" "$PM2_HOME_DIR" "$SERVICE_UID" "$SERVICE_GID"
echo 'Dedicated Unix user home and PM2 state: CLEAN'
if [[ "$(stat -c '%U:%G:%a' "$ROOT")" != 'root:megagoldenclub:750' ||
      "$(stat -c '%U:%G:%a' "$ROOT/api.env")" != 'root:megagoldenclub:640' ]]; then
  echo 'STOP: protected API configuration permissions invalid' >&2; exit 1
fi
id "$SERVICE" >/dev/null
runuser -u "$SERVICE" -- test -r "$ROOT/api.env"
for entry in api/dist/main.js admin/server.js member/server.js; do
  if ! runuser -u "$SERVICE" -- test -r "$RELEASE/$entry"; then
    echo "STOP: dedicated service user cannot read source-free runtime $entry" >&2
    exit 1
  fi
done
test "$(/usr/bin/node -p 'process.versions.node.split(".")[0]')" = 24
for port in 3200 3201 3202; do
  if ss -ltnH "( sport = :$port )" | grep -q .; then
    echo "STOP: reserved port $port already in use" >&2; exit 1
  fi
done
/usr/bin/node --check "$OPS"
/usr/bin/node - "$OPS" <<'JS'
const assert=require('node:assert/strict');
const apps=require(process.argv[2]).apps;
assert.deepEqual(apps.map(a=>a.name).sort(),
  ['megagoldenclub-api','megagoldenclub-admin','megagoldenclub-member'].sort());
for(const [name,port] of [['api','3200'],['admin','3201'],['member','3202']]){
  const a=apps.find(x=>x.name==='megagoldenclub-'+name);
  assert.equal(a.env.PORT,port);
  assert.equal(a.interpreter,'/usr/bin/node');
  assert.equal(a.cwd,'/opt/megagoldenclub/current/'+name);
  assert.equal(a.watch,false);
  assert.equal(a.instances,1);
  assert.equal(a.env.NODE_ENV,'production');
  if(name==='api'){
    assert.equal(a.env.HOST,'127.0.0.1');
    assert.equal(a.node_args,'--env-file=/etc/megagoldenclub/api.env');
    assert.deepEqual(Object.keys(a.env).sort(),['HOST','NODE_ENV','PORT']);
  }else{
    assert.equal(a.env.HOSTNAME,'127.0.0.1');
    assert.equal(a.env.MEGAGOLDENCLUB_API_URL,'http://127.0.0.1:3200');
    assert.deepEqual(Object.keys(a.env).sort(),
      ['HOSTNAME','MEGAGOLDENCLUB_API_URL','NODE_ENV','PORT'].sort());
  }
}
JS
echo 'Dedicated account, reserved ports and secrets-free PM2 config: PASS'

echo '=== CONFIGURE ONLY MEGAGOLDENCLUB OPS FILES ==='
if [[ "$ECOSYSTEM_PRESENT" == 0 ]]; then
  install -o root -g root -m 0644 "$OPS" "$ECOSYSTEM"
fi
install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$HOME_DIR"
install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$PM2_HOME_DIR"
ln -s "$RELEASE" "$CURRENT"
LINKED=1

echo '=== START THREE DEDICATED NON-ROOT PM2 PROCESSES ==='
STARTED=1
pm2_isolated start "$ECOSYSTEM"

echo '=== CHECK API LOCAL READINESS ==='
READY=0
for _ in $(seq 1 50); do
  if BODY="$(curl --silent --max-time 3 --fail http://127.0.0.1:3200/health/ready 2>/dev/null)" &&
    printf '%s' "$BODY" | /usr/bin/node -e '
      let s="";process.stdin.on("data",b=>s+=b);
      process.stdin.on("end",()=>{
        try{let j=JSON.parse(s);
          process.exit(j.status==="ok" &&
            ["mysql","mongodb","redis"].every(k=>j.services?.[k]==="up")?0:1);
        }catch{process.exit(1);}
      });' >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "$READY" != 1 ]]; then
  echo 'STOP: API readiness failed; inspect dedicated user PM2 logs' >&2; exit 1
fi
echo 'API MySQL/MongoDB/Redis readiness: PASS'

for port in 3201 3202; do
  GOOD=0
  for _ in $(seq 1 30); do
    CODE="$(curl --silent --max-time 3 --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$port/" || true)"
    if [[ "$CODE" =~ ^[23][0-9][0-9]$ ]]; then GOOD=1; break; fi
    sleep 1
  done
  if [[ "$GOOD" != 1 ]]; then
    echo "STOP: frontend localhost port $port did not return 2xx/3xx" >&2; exit 1
  fi
  echo "Frontend port $port localhost HTTP: PASS"
done
for port in 3200 3201 3202; do
  if ! ss -ltnH "( sport = :$port )" | grep -q '127.0.0.1:'; then
    echo "STOP: localhost listener missing on $port" >&2; exit 1
  fi
done
echo 'Dedicated application listeners on localhost: PASS'
pm2_isolated save >/dev/null
SUCCESS=1
echo 'DEDICATED SOURCE-FREE DEPLOYMENT: PASS'
echo 'External HTTPS and unrelated-site regression checks: PENDING'
echo 'Backup and financial-operation go-live approval: NOT VERIFIED'
echo 'Dedicated PM2 startup-on-reboot: NOT CONFIGURED'
