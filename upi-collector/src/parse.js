'use strict';

const ALLOWED_SENDERS = ['HDFCBK', 'ICICIB', 'AXISBK', 'SBIINB', 'KOTAKB', 'IDBIBK', 'YESBNK'];

function isAllowedSender(sender) {
  if (!sender) return false;
  return ALLOWED_SENDERS.includes(String(sender).trim().toUpperCase());
}

function parseAmount(text) {
  if (!text) return null;
  const m = String(text).match(/(?:Rs\.?|INR)\s?([\d,]+\.\d{2})/i);
  if (!m) return null;
  const raw = m[1].replace(/,/g, '');
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num.toFixed(2);
}

function parseUtr(text) {
  if (!text) return null;
  const m = String(text).match(/\b(\d{12})\b/);
  return m ? m[1] : null;
}

function parseVpa(text) {
  if (!text) return null;
  const m = String(text).match(/([a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9.\-_]{2,64})/);
  return m ? m[1] : null;
}

function parseNote(text) {
  if (!text) return null;
  const m = String(text).match(/order[:\s#]*([A-Za-z0-9_\-]+)/i);
  return m ? m[1] : null;
}

function parseSms(sender, body) {
  if (!isAllowedSender(sender)) {
    return { sender_not_allowed: true };
  }
  const amount = parseAmount(body);
  const utr = parseUtr(body);
  const vpa = parseVpa(body);
  const note = parseNote(body);

  if (!amount || !utr) {
    return { unparsed: true, amount, utr, vpa, note };
  }

  return { parsed: true, amount, utr, vpa, note };
}

module.exports = { parseSms, isAllowedSender, parseAmount, parseUtr, parseVpa, parseNote, ALLOWED_SENDERS };
