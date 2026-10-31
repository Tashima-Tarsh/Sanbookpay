#!/bin/bash
# DYNAMO PAY — PostgreSQL Backup Script
# Runs hourly via Docker backup service

set -euo pipefail

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/dynamopay_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=7

mkdir -p "${BACKUP_DIR}"

# Create backup
PGPASSWORD_FILE=/run/secrets/db_password pg_dump \
  -h postgres \
  -U dynamopay \
  -d dynamopay \
  | gzip > "${BACKUP_FILE}"

echo "Backup created: ${BACKUP_FILE}"

# Rotate old backups
find "${BACKUP_DIR}" -name "dynamopay_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "Backup rotation complete. Retained ${RETENTION_DAYS} days."
