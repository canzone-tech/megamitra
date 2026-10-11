#!/usr/bin/env bash
set -euo pipefail

# Build only on the trusted CI/build host. The production host receives the
# runtime archive; it does not run npm, Git, Docker Compose or Prisma migrations.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:?Usage: build-production-artifact.sh /absolute/output/directory}"
if [[ "${TARGET}" != /* || -e "${TARGET}" ]]; then
  echo 'ERROR: target must be an unused absolute directory' >&2
  exit 1
fi
if [[ ! -f "${ROOT_DIR}/backend/dist/main.js" ]]; then
  echo 'ERROR: compiled backend/dist/main.js is required' >&2
  exit 1
fi

mkdir -p "${TARGET}/api/dist" "${TARGET}/admin" "${TARGET}/member"
cp -a "${ROOT_DIR}/backend/dist/." "${TARGET}/api/dist/"
find "${TARGET}/api/dist" -type f \( -name '*.map' -o -name '*.ts' -o -name '*.d.ts' -o -name '*.tsbuildinfo' \) -delete
cp "${ROOT_DIR}/backend/package.json" "${ROOT_DIR}/backend/package-lock.json" "${TARGET}/api/"
npm --prefix "${TARGET}/api" ci --omit=dev --no-audit --no-fund
rm "${TARGET}/api/package-lock.json"

for app in admin frontend; do
  echo "==> Building source-free Next.js standalone runtime: ${app}"
  (cd "${ROOT_DIR}/${app}" &&
    NODE_ENV=production SECURITY_HSTS_ENABLED=true MEGAGOLDENCLUB_STANDALONE_BUILD=true npm run build)

  if [[ ! -f "${ROOT_DIR}/${app}/.next/standalone/server.js" ]]; then
    echo "ERROR: missing standalone server.js for ${app}" >&2
    exit 1
  fi
  dest="${TARGET}/member"
  if [[ "${app}" == admin ]]; then dest="${TARGET}/admin"; fi

  cp -a "${ROOT_DIR}/${app}/.next/standalone/." "${dest}/"
  mkdir -p "${dest}/.next"
  cp -a "${ROOT_DIR}/${app}/.next/static" "${dest}/.next/static"
  if [[ -d "${ROOT_DIR}/${app}/public" ]]; then
    cp -a "${ROOT_DIR}/${app}/public" "${dest}/public"
  fi
done

# Only runtime outputs and dependencies can be shipped: never git, TS/TSX
# application sources, DB compose volumes, Prisma schemas, or migrations.
find "${TARGET}" -type f -name '*.map' -not -path '*/node_modules/*' -delete
if find "${TARGET}" -name node_modules -prune -o -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.map' -o -name '*.env' -o -name '.env.*' \
     -o -name '*.prisma' -o -name 'docker-compose.yml' -o -name 'migration.sql' \) \
  -print | grep -q .; then
  echo 'ERROR: original application source or local database configuration found in runtime' >&2
  exit 1
fi
if find "${TARGET}" -name .git -o -name 'docker-compose.yml' | grep -q .; then
  echo 'ERROR: Git/Compose metadata must never be deployed' >&2
  exit 1
fi

RELEASE_SHA="${GITHUB_SHA:-$(git -C "${ROOT_DIR}" rev-parse HEAD)}"
printf '%s\n' "${RELEASE_SHA}" >"${TARGET}/RELEASE_SHA"
if [[ -n "${GITHUB_SHA:-}" && "${RELEASE_SHA}" != "${GITHUB_SHA}" ]]; then
  echo 'ERROR: release identity drift' >&2
  exit 1
fi

tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -C "${TARGET}" -czf "${TARGET}.tar.gz" .
sha256sum "${TARGET}.tar.gz" >"${TARGET}.tar.gz.sha256"
echo "Source-free MegaGoldenClub runtime packaged for ${RELEASE_SHA}"
