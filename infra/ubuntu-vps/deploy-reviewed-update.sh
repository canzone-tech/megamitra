#!/usr/bin/env bash
# Fetch pinned ops helpers; accept a GitHub Release ZIP or a verified uploaded CI artifact ZIP.
# No Git checkout, database migrations, backup/restore or shared service changes.
set -euo pipefail
set +x
umask 077
if [[ "$EUID" -ne 0 || ( "$#" -ne 3 && "$#" -ne 6 ) ||
      ! "$1" =~ ^[0-9a-f]{40}$ || ! "$2" =~ ^[0-9a-f]{40}$ ||
      ! "$3" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'STOP: root-only: deploy-reviewed-update.sh OPS_COMMIT OLD_SHA NEW_SHA [--uploaded-zip ABSOLUTE_ZIP SHA256]' >&2
  exit 1
fi
if [[ "$#" -eq 6 && ( "$4" != '--uploaded-zip' ||
      ! "$6" =~ ^[0-9a-f]{64}$ ) ]]; then
  echo 'STOP: uploaded artifact requires --uploaded-zip and expected GitHub artifact SHA256' >&2
  exit 1
fi

# Tested independently in CI with real fixture bytes and tampering cases.
# Expected digest comes from the pinned, all-green Backend CI artifact metadata.
copy_approved_artifact() {
  local source="$1" expected="$2" destination="$3" actual
  [[ "$source" == /* && -f "$source" && ! -L "$source" &&
     "$source" != "$destination" && ! -e "$destination" &&
     "$expected" =~ ^[a-f0-9]{64}$ ]] || return 1
  cp -- "$source" "$destination" || return 1
  actual="$(sha256sum -- "$destination")" || return 1
  if [[ "${actual%% *}" != "$expected" ]]; then
    rm -f -- "$destination"
    return 1
  fi
}
OPS_COMMIT="$1"
OLD_SHA="$2"
NEW_SHA="$3"
if [[ "$OLD_SHA" == "$NEW_SHA" || "${MEGAGOLDENCLUB_TECHNICAL_DEPLOY_APPROVED:-}" != 'YES' ||
      "${MEGAGOLDENCLUB_RECOVERY_SIGNOFF:-}" != 'YES' ]]; then
  echo 'STOP: explicit deployment and recovery sign-off required (finance HOLD is NOT lifted)' >&2
  exit 1
fi
BASE_URL="https://raw.githubusercontent.com/canzone-tech/megamitra/$OPS_COMMIT/infra/ubuntu-vps"
RELEASE_URL="https://github.com/canzone-tech/megamitra/releases/download/runtime-$NEW_SHA/megagoldenclub-runtime.zip"
WORK="$(mktemp -d /root/megagoldenclub-reviewed-release.XXXXXXXX)"
cleanup() { rm -rf -- "$WORK"; }
trap cleanup EXIT
for name in stage-runtime.py reconcile-staged-runtime.py upgrade-dedicated-runtime.sh ecosystem.config.cjs; do
  curl --fail --location --silent --show-error --retry 3 --max-time 90 \
    "$BASE_URL/$name" -o "$WORK/$name"
done
if [[ "$#" -eq 6 ]]; then
  echo '==> Checking operator-uploaded CI artifact ZIP against GitHub Actions SHA256'
  copy_approved_artifact "$5" "$6" "$WORK/megagoldenclub-runtime.zip" || {
    echo 'STOP: uploaded artifact is absent, unsafe or does not match approved CI SHA256' >&2
    exit 1
  }
else
  curl --fail --location --silent --show-error --retry 3 --max-time 300 \
    "$RELEASE_URL" -o "$WORK/megagoldenclub-runtime.zip"
fi
bash -n "$WORK/upgrade-dedicated-runtime.sh"
echo '==> Verify embedded SHA/checksum and stage a NEW immutable source-free release'
/usr/bin/python3 "$WORK/stage-runtime.py" "$WORK/megagoldenclub-runtime.zip" "$NEW_SHA"
echo '==> Validate whole runtime tree and grant only dedicated service read access'
/usr/bin/python3 "$WORK/reconcile-staged-runtime.py" "$NEW_SHA"
echo '==> Preflight old deployment, release switch and auto-rollback safety'
MEGAGOLDENCLUB_TECHNICAL_DEPLOY_APPROVED=YES \
  bash "$WORK/upgrade-dedicated-runtime.sh" --activate \
  "$OLD_SHA" "$NEW_SHA" "$WORK/ecosystem.config.cjs"
