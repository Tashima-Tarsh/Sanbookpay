> Historical reference: use the [current operations manual](OPERATIONS-MANUAL.md) and [acceptance report](PRODUCTION_ACCEPTANCE_REPORT.md) for this review candidate. Older capability, hosting and automatic-verification statements below are not the current release contract.

# DYNAMO PAY — Infisical Secret Management Configuration
# Infisical provides secure secret storage and rotation
# Replaces .env file for production secrets

# Infisical server URL (self-hosted or Infisical Cloud)
INFISICAL_URL=https://infisical.dynamopay.local

# Infisical project ID (created in Infisical dashboard)
INFISICAL_PROJECT_ID=your-project-id

# Infisical environment (development, staging, production)
INFISICAL_ENVIRONMENT=production

# Infisical service token (machine-to-machine auth)
INFISICAL_SERVICE_TOKEN=your-service-token

# Secret paths in Infisical
INFISICAL_SECRETS_PATH=/payment-gateway

# Dynamo Pay secrets to retrieve from Infisical:
# - ENCRYPTION_MASTER_KEY
# - JWT_SECRET
# - INITIAL_ADMIN_PASSWORD
# - CASHFREE_CLIENT_ID
# - CASHFREE_CLIENT_SECRET
# - CASHFREE_WEBHOOK_SECRET
# - GMAIL_CLIENT_ID
# - GMAIL_CLIENT_SECRET
# - SMS_GATEWAY_API_KEY
# - SVIX_API_KEY
# - SVIX_APPLICATION_ID
# - REDIS_PASSWORD

# Example Infisical CLI usage:
# infisical login --method=universal-auth --client-id=$INFISICAL_CLIENT_ID --client-secret=$INFISICAL_CLIENT_SECRET
# infisical export --env=production --format=env > .env

# Or use Infisical SDK in Node.js:
# const { InfisicalClient } = require('@infisical/sdk');
# const client = new InfisicalClient({ siteUrl: process.env.INFISICAL_URL });
# await client.authenticate({ universalAuth: { clientId, clientSecret } });
# const secret = await client.getSecret({ environment: 'production', projectId, secretName: 'JWT_SECRET' });
