'use strict';

const crypto = require('crypto');
const { get: dbGet } = require('./db');

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function verifyDeviceKey(provided) {
  const expected = process.env.DEVICE_KEY;
  if (!expected) return false;
  return timingSafeEqual(provided, expected);
}

async function verifyHmac(rawBody, providedSig) {
  const expected = process.env.WH_SECRET;
  if (!expected) return false;
  const computed = crypto.createHmac('sha256', expected).update(rawBody).digest('hex');
  return timingSafeEqual(computed, providedSig);
}

async function verifyMiddleware(req, res, next) {
  const deviceKey = req.headers['x-device-key'];
  const sig = req.headers['x-sig'];

  if (!deviceKey || !(await verifyDeviceKey(deviceKey))) {
    return res.status(401).json({ error: 'invalid_device_key' });
  }

  const rawBody = req.rawBody || req.body;
  if (!sig || !(await verifyHmac(rawBody, sig))) {
    return res.status(401).json({ error: 'invalid_hmac' });
  }

  next();
}

module.exports = { verifyMiddleware, verifyDeviceKey, verifyHmac, timingSafeEqual };
