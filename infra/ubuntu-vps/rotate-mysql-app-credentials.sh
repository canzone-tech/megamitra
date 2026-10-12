#!/usr/bin/env bash
# One-time rotation for the existing, database-scoped MegaGoldenClub MySQL
# application principal. Run as VPS root. NEVER store root DB credentials or
# the app password in Git, chat, terminal commands, process arguments or logs.
# The resulting env fragment is to be securely incorporated into api.env
# during a later authorized, source-free production release.
set -euo pipefail
set +x
umask 077

ROOT='/etc/megagoldenclub'
FILE="$ROOT/mysql.credentials.env"
APP_ENV="$ROOT/api.env"
APP_ACCOUNT='megagoldenclub_app'
APP_DB='megagoldenclub'
ROTATED=0
STAGE=''
CLIENT_OPTIONS=''

cleanup() {
  if [[ -n "$CLIENT_OPTIONS" ]]; then rm -f -- "$CLIENT_OPTIONS"; fi
  if [[ -n "$STAGE" && -f "$STAGE" ]]; then
    if [[ "$ROTATED" == '1' ]]; then
      echo "STOP: MySQL may have rotated but credentials are staged at $STAGE" >&2
      echo "Do not repeat a rotation before securing that private staged file." >&2
    else
      rm -f -- "$STAGE"
    fi
  fi
}
trap cleanup EXIT

echo '=== VERIFY DEDICATED MYSQL IDENTITY BOUNDARY ==='
if [[ "$EUID" -ne 0 ]]; then
  echo 'STOP: must run as VPS root' >&2; exit 1
fi
if [[ ! -d "$ROOT" || -L "$ROOT" ||
      "$(stat -c '%U:%G:%a' "$ROOT")" != 'root:megagoldenclub:750' ]]; then
  echo 'STOP: /etc/megagoldenclub must be root:megagoldenclub 0750' >&2; exit 1
fi
if ! id megagoldenclub >/dev/null 2>&1; then
  echo 'STOP: dedicated application Unix user is missing' >&2; exit 1
fi
if [[ -e "$FILE" || -L "$FILE" ]]; then
  echo 'STOP: credential file already exists; this is a one-time initializer' >&2; exit 1
fi
if [[ -e "$APP_ENV" || -L "$APP_ENV" ]]; then
  echo 'STOP: api.env already exists; do not rotate a potentially live account' >&2; exit 1
fi
command -v openssl >/dev/null
command -v mysql >/dev/null

# Stage the new identity BEFORE changing MySQL. This file is readable only
# by root and the dedicated service group; its directory is non-public.
STAGE="$(mktemp "$ROOT/.mysql.credentials.XXXXXXXX")"
CLIENT_OPTIONS="$(mktemp "$ROOT/.mysql.client.XXXXXXXX")"
PASSWORD="$(openssl rand -hex 32)"
if [[ ! "$PASSWORD" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'STOP: invalid cryptographic password generation' >&2; exit 1
fi
{
  printf 'MYSQL_HOST=127.0.0.1\n'
  printf 'MYSQL_PORT=3306\n'
  printf 'MYSQL_DATABASE=%s\n' "$APP_DB"
  printf 'MYSQL_USER=%s\n' "$APP_ACCOUNT"
  printf 'MYSQL_PASSWORD=%s\n' "$PASSWORD"
  printf 'MYSQL_TLS=false\n'
} > "$STAGE"
chown root:megagoldenclub "$STAGE"
chmod 0640 "$STAGE"
{
  printf '[client]\n'
  printf 'user=%s\n' "$APP_ACCOUNT"
  printf 'password=%s\n' "$PASSWORD"
} > "$CLIENT_OPTIONS"
chmod 0600 "$CLIENT_OPTIONS"

echo '=== ROTATE ONLY EXISTING DEDICATED MYSQL USER ==='
echo 'Enter the existing MySQL root password at the private prompt.'
# Critical: send the ALTER via STDIN rather than argv, environment or a
# logged interactive SQL session. Hex password needs no SQL escaping.
# ALTER USER fails closed if this exact account does not exist.
printf "ALTER USER '%s'@'127.0.0.1' IDENTIFIED BY '%s';\n" \
  "$APP_ACCOUNT" "$PASSWORD" |
  mysql --protocol=socket --user=root --password --batch --silent
ROTATED=1

echo '=== VERIFY DEDICATED APP LOGIN (NO SECRET DISPLAY) ==='
# The extra-file contains password but its pathname (not contents) is the
# only item exposed in the mysql process argv.
RESULT="$(mysql --defaults-extra-file="$CLIENT_OPTIONS" \
  --protocol=tcp --host=127.0.0.1 --port=3306 \
  --database="$APP_DB" --batch --skip-column-names --silent \
  -e 'SELECT CURRENT_USER(), DATABASE();')"
if [[ "$RESULT" != "$(printf '%s\t%s' "$APP_ACCOUNT@127.0.0.1" "$APP_DB")" ]]; then
  echo 'STOP: exact MySQL application identity verification failed' >&2; exit 1
fi

echo '=== COMMIT SECURE SERVER CREDENTIAL FILE ==='
if [[ -e "$FILE" || -L "$FILE" ]]; then
  echo 'STOP: credential destination appeared unexpectedly' >&2; exit 1
fi
mv -T -- "$STAGE" "$FILE"
STAGE=''
if [[ "$(stat -c '%U:%G:%a' "$FILE")" != 'root:megagoldenclub:640' ]]; then
  echo 'STOP: saved credentials permissions are invalid' >&2; exit 1
fi
runuser -u megagoldenclub -- test -r "$FILE"
unset PASSWORD
echo "MySQL scoped app identity: $APP_ACCOUNT@127.0.0.1"
echo "MySQL application database: $APP_DB"
echo "Protected credentials saved: $FILE"
echo 'MySQL app login and server-side credential save: PASS'
echo 'No other database, Unix account, PM2 process or Docker service changed.'
echo 'Later app deployment must merge this fragment into protected api.env.'
