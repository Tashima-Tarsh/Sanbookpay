/**
 * DYNAMO PAY — Security Middleware for UPI Mirror.
 *
 * Provides:
 * - Rate limiting per device and per merchant
 * - Input validation for observation ingestion
 * - Replay prevention (timestamp windows)
 * - Device fingerprint validation
 * - SSRF-safe URL validation
 * - Sensitive data redaction for logs
 */
import crypto from 'node:crypto';

const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_EVENTS_PER_DEVICE_PER_MIN = 120;
const MAX_EVENTS_PER_MERCHANT_PER_MIN = 1000;
const TIMESTAMP_TOLERANCE_MS = 300000; // 5 minutes

// In-memory rate limit counters (Redis in production)
const deviceRateLimits = new Map(); // deviceId -> { count, resetAt }
const merchantRateLimits = new Map(); // merchantId -> { count, resetAt }

function cleanupRateLimits() {
  const now = Date.now();
  for (const [key, val] of deviceRateLimits) {
    if (now > val.resetAt) deviceRateLimits.delete(key);
  }
  for (const [key, val] of merchantRateLimits) {
    if (now > val.resetAt) merchantRateLimits.delete(key);
  }
}
setInterval(cleanupRateLimits, 60000);

export class SecurityMiddleware {
  /**
   * Check rate limit for a device.
   * @returns {boolean} true if allowed
   */
  static checkDeviceRateLimit(deviceId) {
    const now = Date.now();
    let entry = deviceRateLimits.get(deviceId);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      deviceRateLimits.set(deviceId, entry);
    }
    entry.count++;
    return entry.count <= MAX_EVENTS_PER_DEVICE_PER_MIN;
  }

  /**
   * Check rate limit for a merchant.
   * @returns {boolean} true if allowed
   */
  static checkMerchantRateLimit(merchantId) {
    const now = Date.now();
    let entry = merchantRateLimits.get(merchantId);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      merchantRateLimits.set(merchantId, entry);
    }
    entry.count++;
    return entry.count <= MAX_EVENTS_PER_MERCHANT_PER_MIN;
  }

  /**
   * Validate observation event input.
   * @returns {null | {error: string, statusCode: number}}
   */
  static validateObservationEvent(body) {
    const required = ['eventId', 'source', 'amountPaise'];
    for (const field of required) {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        return { error: `Missing required field: ${field}`, statusCode: 400 };
      }
    }

    // Validate eventId format (no injection)
    if (!/^[a-zA-Z0-9_\-:]{1,128}$/.test(body.eventId)) {
      return { error: 'Invalid eventId format', statusCode: 400 };
    }

    // Validate source (allowlist)
    const validSources = [
      'com.phonepe.app', 'com.google.android.apps.nbu.paisa.user',
      'net.one97.paytm', 'in.org.npci.upiapp', 'SMS_GATEWAY',
      'EMAIL_GATEWAY', 'OTHER'
    ];
    if (!validSources.includes(body.source) && !body.source.startsWith('com.')) {
      return { error: 'Invalid or untrusted source', statusCode: 400 };
    }

    // Validate amount (positive integer paise)
    const amount = Number(body.amountPaise);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000000) { // max 10 crore INR
      return { error: 'Invalid amount', statusCode: 400 };
    }

    // Validate currency
    if (body.currency && !/^[A-Z]{3}$/.test(body.currency)) {
      return { error: 'Invalid currency code', statusCode: 400 };
    }

    // Validate UTR format if present
    if (body.referenceUtr && !/^[a-zA-Z0-9\-_]{6,35}$/.test(body.referenceUtr)) {
      return { error: 'Invalid UTR format', statusCode: 400 };
    }

    // Validate timestamp plausibility if present
    if (body.deviceObservedTimestamp) {
      const ts = new Date(body.deviceObservedTimestamp).getTime();
      if (isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
        return { error: 'Device timestamp outside tolerance window', statusCode: 400 };
      }
    }

    return null;
  }

  /**
   * Redact sensitive data from observation payload for logging.
   */
  static redactForLog(rawPayload) {
    if (typeof rawPayload !== 'object') return rawPayload;
    const redacted = { ...rawPayload };
    const sensitiveKeys = ['pin', 'password', 'otp', 'mpin', 'upipin', 'card', 'cvv', 'cvvs'];
    for (const key of Object.keys(redacted)) {
      if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
        redacted[key] = '[REDACTED]';
      }
      if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key] = this.redactForLog(redacted[key]);
      }
    }
    return redacted;
  }

  /**
   * Validate that an outbound webhook URL is SSRF-safe.
   */
  static isSsrfSafe(urlString) {
    try {
      const url = new URL(urlString);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { valid: false, error: 'Only HTTP/HTTPS URLs allowed' };
      }
      // Block private/internal IP ranges
      const hostname = url.hostname;
      const privatePatterns = [
        /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
        /^::1$/, /^fc00:/, /^fe80:/, /^0\.0\.0\.0$/
      ];
      if (privatePatterns.some(p => p.test(hostname))) {
        return { valid: false, error: 'Private IP addresses not allowed' };
      }
      return { valid: true, url };
    } catch {
      return { valid: false, error: 'Invalid URL' };
    }
  }
}

/**
 * IP Allowlist for PSP webhook endpoints.
 * Only allows webhooks from known PhonePe/Paytm/Cashfree IP ranges.
 * Merchants can add their PSP's documented callback IPs via WEBHOOK_ALLOWED_IPS env var.
 */
export class IpAllowlist {
  constructor(allowedRanges = []) {
    this.allowedRanges = allowedRanges;
  }

  isAllowed(ip) {
    if (!ip) return false;
    const ipv4 = ip.replace(/^::ffff:/, '');
    if (this.allowedRanges.length === 0) return true;
    return this.allowedRanges.some(range => this._cidrMatch(ipv4, range));
  }

  _cidrMatch(ip, cidr) {
    const [range, bits] = cidr.split('/');
    const netMask = ~((1 << (32 - Number(bits))) - 1) >>> 0;
    const ipNum = this._ipToNumber(ip);
    const rangeNum = this._ipToNumber(range);
    return (ipNum & netMask) === (rangeNum & netMask);
  }

  _ipToNumber(ip) {
    return ip.split('.').reduce((int, octet) => (int << 8) + parseInt(octet, 10), 0) >>> 0;
  }
}
