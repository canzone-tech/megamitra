#!/usr/bin/env bash
# Provision ONLY the missing MegaGoldenClub MongoDB application user on the
# independently running dedicated Docker MongoDB (:27019).
# Do not reset MongoDB, touch existing volumes, or alter unrelated services.
# Passwords are never printed or sent as command-line args.
set -euo pipefail
set +x
umask 077

CONTAINER='megagoldenclub-mongo'
IMAGE='mongo:8.0.29-noble'
ROOT_DIR='/etc/megagoldenclub'
SECRET_DIR="$ROOT_DIR/mongo"
ROOT_SECRET="$SECRET_DIR/root-password"
APP_SECRET="$SECRET_DIR/app-password"
APP_ENV="$ROOT_DIR/mongo.credentials.env"
APP_DB='megagoldenclub'
APP_USER='megagoldenclub_app'
STAGE_SECRET=''
STAGE_ENV=''
CREATION_ATTEMPTED=0

cleanup() {
  if [[ "$CREATION_ATTEMPTED" == '1' ]]; then
    # A network error could occur after the server accepted createUser.
    # Preserve the staged password rather than lose the only secret.
    if [[ -n "$STAGE_SECRET" && -f "$STAGE_SECRET" ]]; then
      echo "STOP: MongoDB user creation may have occurred; private app password preserved at $STAGE_SECRET" >&2
    fi
    if [[ -n "$STAGE_ENV" && -f "$STAGE_ENV" ]]; then
      echo "Private MongoDB API env fragment preserved at $STAGE_ENV" >&2
    fi
  else
    if [[ -n "$STAGE_SECRET" ]]; then rm -f -- "$STAGE_SECRET"; fi
    if [[ -n "$STAGE_ENV" ]]; then rm -f -- "$STAGE_ENV"; fi
  fi
}
trap cleanup EXIT

echo '=== VERIFY DEDICATED MONGODB BOUNDARY ==='
if [[ "$EUID" -ne 0 ]]; then
  echo 'STOP: run as VPS root' >&2
  exit 1
fi
if [[ "$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)" != "$IMAGE" ||
      "$(docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)" != 'running' ]]; then
  echo 'STOP: expected dedicated MongoDB Docker container is not running' >&2
  exit 1
fi
if [[ ! -d "$SECRET_DIR" || -L "$SECRET_DIR" ||
      "$(stat -c '%u:%a' "$SECRET_DIR")" != '0:700' ||
      ! -f "$ROOT_SECRET" || -L "$ROOT_SECRET" ]]; then
  echo 'STOP: private MongoDB bootstrap secret directory/file is invalid' >&2
  exit 1
fi
if [[ ! -d "$ROOT_DIR" || -L "$ROOT_DIR" ||
      "$(stat -c '%U:%G:%a' "$ROOT_DIR")" != 'root:megagoldenclub:750' ]]; then
  echo 'STOP: expected root:megagoldenclub mode 0750 config directory is missing' >&2
  exit 1
fi
if ! id megagoldenclub >/dev/null 2>&1; then
  echo 'STOP: dedicated MegaGoldenClub Unix user is missing' >&2
  exit 1
fi
for forbidden_existing in "$APP_SECRET" "$APP_ENV"; do
  if [[ -e "$forbidden_existing" || -L "$forbidden_existing" ]]; then
    echo "STOP: existing application credential file present: $forbidden_existing" >&2
    exit 1
  fi
done
command -v openssl >/dev/null
ROOT_PASSWORD="$(<"$ROOT_SECRET")"
if [[ ! "$ROOT_PASSWORD" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'STOP: bootstrap secret format is not the expected generated password' >&2
  exit 1
fi

echo '=== VERIFY ROOT LOGIN AND APPLICATION USER ABSENT ==='
{
  printf 'const rootPwd = "%s";\n' "$ROOT_PASSWORD"
  cat <<'JS'
const authenticated = db.getSiblingDB("admin").auth("megagoldenclub_root", rootPwd);
if (!(authenticated === 1 || authenticated?.ok === 1)) {
  throw new Error("Root authentication failed");
}
const app = db.getSiblingDB("megagoldenclub");
if (app.getUser("megagoldenclub_app") !== null) {
  throw new Error("STOP: application user already exists; do not reset");
}
print("MongoDB root auth: PASS; application user absent");
JS
} | docker exec -i "$CONTAINER" mongosh --quiet --file /dev/stdin

echo '=== GENERATE AND STAGE PRIVATE APP CREDENTIALS ==='
STAGE_SECRET="$(mktemp "$SECRET_DIR/.app-password.XXXXXXXX")"
STAGE_ENV="$(mktemp "$ROOT_DIR/.mongo.credentials.XXXXXXXX")"
APP_PASSWORD="$(openssl rand -hex 32)"
if [[ ! "$APP_PASSWORD" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'STOP: strong password generation failed' >&2
  exit 1
fi
printf '%s\n' "$APP_PASSWORD" > "$STAGE_SECRET"
chmod 0600 "$STAGE_SECRET"
{
  printf 'MONGODB_URI=mongodb://%s:%s@127.0.0.1:27019/%s?authSource=%s\n' \
    "$APP_USER" "$APP_PASSWORD" "$APP_DB" "$APP_DB"
} > "$STAGE_ENV"
chown root:megagoldenclub "$STAGE_ENV"
chmod 0640 "$STAGE_ENV"
runuser -u megagoldenclub -- test -r "$STAGE_ENV"

echo '=== CREATE ONLY SCOPED MONGODB APPLICATION USER ==='
CREATION_ATTEMPTED=1
{
  printf 'const rootPwd = "%s";\n' "$ROOT_PASSWORD"
  printf 'const appPwd = "%s";\n' "$APP_PASSWORD"
  cat <<'JS'
const authenticated = db.getSiblingDB("admin").auth("megagoldenclub_root", rootPwd);
if (!(authenticated === 1 || authenticated?.ok === 1)) {
  throw new Error("Root authentication failed");
}
const app = db.getSiblingDB("megagoldenclub");
if (app.getUser("megagoldenclub_app") !== null) {
  throw new Error("STOP: application user already exists; no overwrite");
}
const result = app.runCommand({
  createUser: "megagoldenclub_app",
  pwd: appPwd,
  roles: [{role: "readWrite", db: "megagoldenclub"}],
  mechanisms: ["SCRAM-SHA-256"],
  writeConcern: {w: "majority"}
});
if (result.ok !== 1) {
  throw new Error("MongoDB app user create failed");
}
const saved = app.getUser("megagoldenclub_app");
if (!saved || saved.roles.length !== 1 ||
    saved.roles[0].role !== "readWrite" ||
    saved.roles[0].db !== "megagoldenclub") {
  throw new Error("Unexpected MongoDB application role; abort");
}
print("MongoDB application user and scoped role: CREATED");
JS
} | docker exec -i "$CONTAINER" mongosh --quiet --file /dev/stdin

echo '=== VERIFY APPLICATION AUTHENTICATION ==='
{
  printf 'const appPwd = "%s";\n' "$APP_PASSWORD"
  cat <<'JS'
const app = db.getSiblingDB("megagoldenclub");
const authenticated = app.auth("megagoldenclub_app", appPwd);
if (!(authenticated === 1 || authenticated?.ok === 1)) {
  throw new Error("Application authentication failed");
}
const status = app.runCommand({connectionStatus:1}).authInfo.authenticatedUsers;
if (status.length !== 1 ||
    status[0].user !== "megagoldenclub_app" ||
    status[0].db !== "megagoldenclub" ||
    app.runCommand({ping:1}).ok !== 1) {
  throw new Error("Application identity or ping mismatch");
}
print("MONGODB APPLICATION LOGIN: PASS");
JS
} | docker exec -i "$CONTAINER" mongosh --quiet --file /dev/stdin

echo '=== COMMIT PROTECTED SERVER CREDENTIAL FILES ==='
if [[ -e "$APP_SECRET" || -L "$APP_SECRET" ||
      -e "$APP_ENV" || -L "$APP_ENV" ]]; then
  echo 'STOP: application credentials destination appeared unexpectedly' >&2
  exit 1
fi
mv -T "$STAGE_SECRET" "$APP_SECRET"
STAGE_SECRET=''
mv -T "$STAGE_ENV" "$APP_ENV"
STAGE_ENV=''
if [[ "$(stat -c '%U:%G:%a' "$APP_ENV")" != 'root:megagoldenclub:640' ||
      "$(stat -c '%u:%a' "$APP_SECRET")" != '0:600' ]]; then
  echo 'STOP: saved credential file permissions invalid' >&2
  exit 1
fi
CREATION_ATTEMPTED=0
unset APP_PASSWORD ROOT_PASSWORD
echo "MongoDB app user: $APP_USER (readWrite on $APP_DB only)"
echo "Private password saved: $APP_SECRET"
echo "Protected API env fragment saved: $APP_ENV"
echo 'MONGODB APPLICATION LOGIN AND CREDENTIAL STORAGE: PASS'
echo 'Existing host MongoDB, other containers, volumes and MySQL: UNTOUCHED'
