#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-stg}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "${TARGET}" in
  stg|prd) ;;
  *)
    echo "Usage: npm run db:use:stg | npm run db:use:prd" >&2
    exit 1
    ;;
esac

SOURCE_ENV="${ROOT_DIR}/be/.env.${TARGET}.local"
ACTIVE_ENV="${ROOT_DIR}/be/.env"

if [[ ! -f "${SOURCE_ENV}" ]]; then
  echo "Missing ${SOURCE_ENV}" >&2
  echo "Ask a teammate to create the local-only DB env profile first." >&2
  exit 1
fi

cp "${SOURCE_ENV}" "${ACTIVE_ENV}"
chmod 600 "${ACTIVE_ENV}"
echo "Backend DATABASE_TARGET is now ${TARGET}."
