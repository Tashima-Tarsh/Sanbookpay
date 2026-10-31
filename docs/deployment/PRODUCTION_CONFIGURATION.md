# Production Configuration

## Requirements

- Node.js 22.13+
- PostgreSQL database
- Approved bank/PSP credentials
- SSL/TLS termination
- Secret management

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes (for production) |
| `ENCRYPTION_MASTER_KEY` | Credential encryption key | Yes |
| `BASE_CHECKOUT_URL` | Public checkout origin | Yes |
| `PAYMENT_API_PORT` | API server port | No (default 6100) |
| `SUPER_ADMIN_PORT` | Super Admin port | No (default 9000) |
| `WEBHOOK_MAX_RETRIES` | Max webhook retry attempts | No (default 5) |
| `PAYMENT_ACTIVE_WINDOW_MS` | Active payment window | No (default 300000) |
| `PAYMENT_PROCESSING_WINDOW_MS` | Processing window | No (default 30000) |

## Security

- Use HTTPS in production
- Set `NODE_ENV=production`
- Secure cookie flags enabled automatically
- Rate limiting enabled by default
- CSRF protection on state-changing requests
- MFA required for sensitive operations

## Deployment

- Run `npm run build:typescript` to validate types
- Run `npm test` to verify all tests pass
- Run `node scripts/scan-secrets.js` to check for committed secrets
- Deploy with a process manager (systemd, Docker, etc.)