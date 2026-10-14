#!/usr/bin/env bash
# Download the exact reviewed GitHub runtime and operations-only upgrade helpers.
# No Git checkout, database migrations, backup/restore or shared service changes.
set -euo pipefail
set +x
umask 077
if [[ "$EUID" -ne 0 || "$#" -ne 3 ||
      ! "$1" =~ ^[0-9a-f]{40}$ || ! "$2" =~ ^[0-9a-f]{40}$ ||
      ! "$3" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'STOP: root-only: deploy-reviewed-update.sh OPS_COMMIT OLD_RELEASE_SHA NEW_RELEASE_SHA' >&2
  exit 1
fi
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
curl --fail --location --silent --show-error --retry 3 --max-time 300 \
  "$RELEASE_URL" -o "$WORK/megagoldenclub-runtime.zip"
bash -n "$WORK/upgrade-dedicated-runtime.sh"
echo '==> Verify embedded SHA/checksum and stage a NEW immutable source-free release'
/usr/bin/python3 "$WORK/stage-runtime.py" "$WORK/megagoldenclub-runtime.zip" "$NEW_SHA"
echo '==> Validate whole runtime tree and grant only dedicated service read access'
/usr/bin/python3 "$WORK/reconcile-staged-runtime.py" "$NEW_SHA"
echo '==> Preflight old deployment, release switch and auto-rollback safety'
MEGAGOLDENCLUB_TECHNICAL_DEPLOY_APPROVED=YES \
  bash "$WORK/upgrade-dedicated-runtime.sh" --activate \
  "$OLD_SHA" "$NEW_SHA" "$WORK/ecosystem.config.cjs"
