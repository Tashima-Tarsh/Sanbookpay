'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WH_SECRET = process.env.WH_SECRET || 'b9f6a92a37d23a5f2945ce0dd59ad540276c96c50023997057c2d7ce376f27f5';
const DEVICE_KEY = process.env.DEVICE_KEY || 'e1e22a5d5347acbdbea6fe835b6c54ec5c212b94924115f78270e0483765f7ee';

const OUT_DIR = path.join(__dirname, '..', 'data', 'test-vectors');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const ts = new Date().toISOString();

const cases = [
  { name: 'valid', sender: 'HDFCBK', body: 'Rs. 300.00 credited to your account. UTR: 123456789012', deviceId: 'dev-001', ts },
  { name: 'bad_sender', sender: 'UNKNOWN', body: 'Rs. 300.00 credited UTR: 123456789015', deviceId: 'dev-001', ts, deviceKey: DEVICE_KEY },
  { name: 'duplicate', sender: 'HDFCBK', body: 'Rs. 300.00 credited to your account. UTR: 123456789012', deviceId: 'dev-001', ts },
  { name: 'garbage', raw: 'this is not json at all', deviceId: 'dev-001' },
  { name: 'unsigned', sender: 'HDFCBK', body: 'Rs. 300.00 credited UTR: 123456789016', deviceId: 'dev-001', ts },
];

for (const c of cases) {
  let bodyStr;
  if (c.raw) {
    bodyStr = c.raw;
  } else {
    bodyStr = JSON.stringify({ sender: c.sender, body: c.body, ts: c.ts, device_id: c.deviceId });
  }
  const bodyBytes = Buffer.from(bodyStr, 'utf8');
  const sig = crypto.createHmac('sha256', WH_SECRET).update(bodyBytes).digest('hex');

  // Write body file
  fs.writeFileSync(path.join(OUT_DIR, c.name + '.body'), bodyStr);
  // Write sig file
  fs.writeFileSync(path.join(OUT_DIR, c.name + '.sig'), sig);
  // Write device key file
  fs.writeFileSync(path.join(OUT_DIR, c.name + '.key'), c.deviceKey || DEVICE_KEY);
  // Write expected status
  const expected = c.name === 'bad_sender' ? 422 : (c.name === 'garbage' ? 200 : (c.name === 'unsigned' ? 401 : 200));
  fs.writeFileSync(path.join(OUT_DIR, c.name + '.expected'), String(expected));
}

console.log('Test vectors written to', OUT_DIR);
console.log('Cases:', cases.map(c => c.name).join(', '));
