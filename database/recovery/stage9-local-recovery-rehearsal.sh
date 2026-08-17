#!/usr/bin/env bash
set -euo pipefail

# MuradERP-AI Phase 23 / Stage 9
# Safe local isolated backup/restore rehearsal.
#
# Requirements on the execution machine:
#   - Supabase CLI
#   - Docker
#   - a read-only-capable production DB connection URL supplied via SUPABASE_DB_URL
#
# Safety:
#   - never targets the production database for restore
#   - restores only into the local Supabase database
#   - backup is kept outside the repository and deleted on exit
#   - backup contents are never printed

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the authorized Supabase database connection URL}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${TMPDIR:-/tmp}/muraderp-stage9-$$"
BACKUP_FILE="${BACKUP_DIR}/production.dump"

cleanup() {
  rm -rf "${BACKUP_DIR}"
  # Stop local Supabase if this rehearsal started it.
  if [[ "${STARTED_LOCAL_SUPABASE:-0}" == "1" ]]; then
    (cd "${ROOT_DIR}" && supabase stop >/dev/null 2>&1 || true)
  fi
}
trap cleanup EXIT

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

cd "${ROOT_DIR}"

printf '%s\n' '[Stage 9] Starting local isolated recovery rehearsal.'
printf '%s\n' '[Stage 9] Production database will be read only; restore target is local Supabase only.'

supabase start >/dev/null
STARTED_LOCAL_SUPABASE=1

printf '%s\n' '[Stage 9] Creating logical backup (metadata and data are not printed).' 
supabase db dump \
  --db-url "${SUPABASE_DB_URL}" \
  -f "${BACKUP_FILE}" \
  --data-only=false

if [[ ! -s "${BACKUP_FILE}" ]]; then
  echo '[Stage 9] ERROR: backup file was not created.' >&2
  exit 1
fi

printf '%s\n' '[Stage 9] Resetting local isolated database to the repository baseline.'
supabase db reset --local

printf '%s\n' '[Stage 9] Restoring backup into the local isolated database.'
supabase db restore --local "${BACKUP_FILE}"

printf '%s\n' '[Stage 9] Running read-only recovery verification.'
LOCAL_DB_URL="$(supabase status --output env | awk -F= '/DB_URL=/{print substr($0,index($0,"=")+1)}')"

if [[ -z "${LOCAL_DB_URL}" ]]; then
  echo '[Stage 9] ERROR: could not resolve local DB URL.' >&2
  exit 1
fi

psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1 -f database/recovery/stage9-recovery-verification.sql

printf '%s\n' '[Stage 9] Local isolated restore rehearsal PASSED.'
printf '%s\n' '[Stage 9] Backup and restored database are deleted/stopped during cleanup.'
