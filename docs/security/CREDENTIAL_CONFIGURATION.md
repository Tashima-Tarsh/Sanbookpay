# Credential Configuration

## Storage

- API key secrets: SHA-256 hashed in database
- Client secrets: encrypted at rest using encryption master key
- Webhook secrets: encrypted at rest
- MFA secrets: encrypted at rest

## Environment Variables

- `ENCRYPTION_MASTER_KEY` — Used for encrypting sensitive credentials
- `PLATFORM_VERIFICATION_URL` — URL for sending verification emails/SMS
- `PLATFORM_VERIFICATION_TOKEN` — Bearer token for verification delivery
- `ENCRYPTION_MASTER_KEY` or `ENCRYPTION_MASTER_KEY` env var

## Security Rules

- Never commit plaintext credentials to Git
- Never email plaintext passwords
- Use one-time activation links for account setup
- Rotate credentials through secure workflows
- Platform Owner never sees merchant passwords or raw secrets
- Credentials stored outside public source control in access-controlled location