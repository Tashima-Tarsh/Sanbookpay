# Backup and Recovery

## Database Backup

- PostgreSQL: Use `pg_dump` for logical backups
- SQLite: Copy the database file
- Backup frequency: Daily minimum, hourly for high-volume merchants

## Recovery

1. Restore database from backup
2. Verify data integrity
3. Restart services
4. Verify webhook delivery queue
5. Reconcile any pending payments

## Disaster Recovery

- Cross-tenant isolation ensures merchant data is never mixed
- Audit logs provide immutable record of all actions
- Ledger entries are immutable and can be used for financial recovery
- Webhook deliveries are retried with exponential backoff
- Idempotency keys prevent duplicate processing on replay

## Testing

- Test restore procedures regularly
- Verify backup completeness
- Document recovery time objectives