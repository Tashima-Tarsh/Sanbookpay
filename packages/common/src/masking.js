/**
 * Customer Details Masking & Auto-Generation Utilities
 */

export function maskPhone(phone) {
  if (!phone) return '—';
  const clean = String(phone).replace(/\D/g, '');
  if (clean.length < 4) return '***';
  const last2 = clean.slice(-2);
  const first2 = clean.slice(0, 2);
  return `+91 ${first2}*** ***${last2}`;
}

export function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '—';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

export function generateCustomerId(prefix = 'CUST') {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${ts}-${rand}`;
}

