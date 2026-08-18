#!/usr/bin/env bash
set -euo pipefail

# MuradERP-AI Phase 23 / Stage 9
# Safe local isolated logical-backup/restore rehearsal.
#
# Requirements on the execution machine:
#   - Supabase CLI
#   - Docker
#   - psql client
#   - SUPABASE_DB_URL: authorized production DB connection string
#
# Safety:
#   - production is used only as a read source for logical dumps
#   - restore target is local Supabase only
#   - backup files live outside the repository with mode 700/600
#   - backup contents are never printed
#   - all temporary backup files are deleted on exit

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the authorized Supabase database connection URL}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${TMPDIR:-/tmp}/muraderp-stage9-$$"
ROLES_FILE="${BACKUP_DIR}/roles.sql"
SCHEMA_FILE="${BACKUP_DIR}/schema.sql"
DATA_FILE="${BACKUP_DIR}/data.sql"
LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
STARTED_LOCAL_SUPABASE=0

cleanup() {
  rm -rf "${BACKUP_DIR}"
  if [[ "${STARTED_LOCAL_SUPABASE}" == "1" ]]; then
    (cd "${ROOT_DIR}" && supabase stop --no-backup >/dev/null 2>&1 || true)
  fi
}
trap cleanup EXIT

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

for command in supabase docker psql; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "[Stage 9] ERROR: required command not found: ${command}" >&2
    exit 1
  fi
done

cd "${ROOT_DIR}"

printf '%s\n' '[Stage 9] Starting safe local isolated recovery rehearsal.'
printf '%s\n' '[Stage 9] Production is read-only source; restore target is local only.'

supabase start >/dev/null
STARTED_LOCAL_SUPABASE=1

printf '%s\n' '[Stage 9] Creating roles/schema/data logical backups.'
supabase db dump --db-url "${SUPABASE_DB_URL}" -f "${ROLES_FILE}" --role-only
supabase db dump --db-url "${SUPABASE_DB_URL}" -f "${SCHEMA_FILE}"
supabase db dump --db-url "${SUPABASE_DB_URL}" -f "${DATA_FILE}" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"

for backup_file in "${ROLES_FILE}" "${SCHEMA_FILE}" "${DATA_FILE}"; do
  if [[ ! -s "${backup_file}" ]]; then
    echo "[Stage 9] ERROR: missing or empty backup file." >&2
    exit 1
  fi
  chmod 600 "${backup_file}"
done

printf '%s\n' '[Stage 9] Recreating local database from repository migrations before restore.'
supabase db reset --local --no-seed

printf '%s\n' '[Stage 9] Replacing local public schema with the backed-up public schema.'
psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;'

printf '%s\n' '[Stage 9] Restoring roles, schema and data into the local isolated database.'
psql --single-transaction --variable ON_ERROR_STOP=1 --file "${ROLES_FILE}" --dbname "${LOCAL_DB_URL}"
psql --single-transaction --variable ON_ERROR_STOP=1 --file "${SCHEMA_FILE}" --dbname "${LOCAL_DB_URL}"
psql --single-transaction --variable ON_ERROR_STOP=1 --command 'SET session_replication_role = replica' --file "${DATA_FILE}" --dbname "${LOCAL_DB_URL}"

printf '%s\n' '[Stage 9] Running read-only recovery verification.'
psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1 -f database/recovery/stage9-recovery-verification.sql

printf '%s\n' '[Stage 9] Local isolated logical backup/restore rehearsal PASSED.'
printf '%s\n' '[Stage 9] Temporary backup files and local database are removed by cleanup.'
