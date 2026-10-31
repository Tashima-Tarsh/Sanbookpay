/**
 * YOUPI PG — Production Environment Validator
 * Runs at server startup to refuse boot when required secrets are missing
 * or using unsafe placeholder values. Prevents silent production failures.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), '..');
const ENV_FILE = path.resolve(ROOT, '.env');

const REQUIRED = [
  'NODE_ENV',
  'ENCRYPTION_MASTER_KEY',
  'JWT_SECRET',
  'INITIAL_ADMIN_EMAIL',
  'INITIAL_ADMIN_PASSWORD',
];

const UNSAFE_PLACEHOLDERS = [
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'youpi_jwt_secret_change_in_production_min_32_chars_long',
  'AdminSecurePassword123!',
  'android_pairing_enrollment_secret_key_32_chars',
];

function loadEnv() {
  if (typeof process.loadEnvFile === 'function') {
    try {
      if (fs.existsSync(ENV_FILE)) {
        // Preserve NODE_ENV if already set (e.g. test mode), since loadEnvFile overwrites it
        const existingNodeEnv = process.env.NODE_ENV;
        process.loadEnvFile(ENV_FILE);
        if (existingNodeEnv) process.env.NODE_ENV = existingNodeEnv;
      }
      return;
    } catch {}
  }
  // Fallback: parse .env manually
  if (!fs.existsSync(ENV_FILE)) return;
  const text = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function isPlaceholder(value) {
  return UNSAFE_PLACEHOLDERS.includes(value);
}

export default function validateEnv() {
  loadEnv();
  const errors = [];
  const warnings = [];

  const isProduction = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true' || /test/.test(process.argv[1] || '');

  // Required vars: must exist in all environments, but placeholder check only in production
  for (const key of REQUIRED) {
    const value = process.env[key];
    if (!value) {
      errors.push(`Missing required env var: ${key}`);
    } else if (isProduction && !isTest && isPlaceholder(value)) {
      errors.push(`Unsafe placeholder value for: ${key} (generate a real secret)`);
    } else if (key === 'ENCRYPTION_MASTER_KEY' && value.length < 64) {
      errors.push(`ENCRYPTION_MASTER_KEY must be at least 64 hex characters`);
    } else if (key === 'JWT_SECRET' && value.length < 32) {
      errors.push(`JWT_SECRET must be at least 32 characters`);
    }
  }

  // Optional-but-recommended for production
  const recommended = [
    'CASHFREE_CLIENT_ID',
    'CASHFREE_CLIENT_SECRET',
    'CASHFREE_WEBHOOK_SECRET',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
  ];
  for (const key of recommended) {
    if (!process.env[key]) warnings.push(`Optional env var not set: ${key}`);
  }

  if (process.env.NODE_ENV === 'production' && process.env.YOUPI_BIND_HOST === '0.0.0.0') {
    warnings.push('YOUPI_BIND_HOST=0.0.0.0 exposes services on all interfaces; use a reverse proxy with TLS');
  }

  if (errors.length > 0) {
    console.error('\n[FATAL] Production environment validation failed:');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('\nFix .env then restart. Generate secrets:');
    console.error("  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n");
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n[WARN] Production environment notices:');
    for (const w of warnings) console.warn(`  - ${w}`);
    console.warn('');
  }

  console.log('[OK] Production environment validated');
  return true;
}
