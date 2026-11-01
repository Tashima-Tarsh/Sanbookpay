'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { initDb, log: dbLog } = require('./db');

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(helmet());
app.use(cors());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    dbLog('info', `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`).catch(() => {});
  });
  next();
});

// JSON body parser only for routes that need it (orders, admin)
// Notify route uses express.raw() internally for HMAC verification
app.use('/api/v1/orders', express.json());
app.use('/api/v1/admin', express.json());

app.use('/api/v1/upi/notify', require('./routes/upi'));
app.use('/api/v1/orders', require('./routes/orders'));
app.use('/api/v1/admin', require('./routes/admin'));

app.get('/api/v1/health', async (req, res) => {
  const lastSms = await require('./db').get('SELECT MAX(received_at) as last_sms_at FROM sms_events');
  const { queueDepth } = require('./notify');
  const row = await require('./db').all('SELECT COUNT(*) as c FROM sms_events WHERE received_at >= datetime("now", "-10 minutes")');
  const recent = row[0] ? row[0].c : 0;
  return res.json({
    ok: recent > 0,
    last_sms_at: lastSms ? lastSms.last_sms_at : null,
    queue_depth: queueDepth(),
    recent_sms_10m: recent,
  });
});

initDb().then(() => {
  const cron = require('node-cron');
  const { reconcile } = require('./reconcile');
  const reconcileCron = process.env.RECONCILE_CRON || '0 2 * * *';
  cron.schedule(reconcileCron, async () => {
    try {
      const result = await reconcile();
      dbLog('info', 'nightly reconcile ran', result).catch(() => {});
    } catch (e) {
      dbLog('error', 'nightly reconcile failed', { error: e.message }).catch(() => {});
    }
  });

  const server = app.listen(PORT, HOST, () => {
    dbLog('info', `UPI Collector listening on ${HOST}:${PORT}`).catch(() => {});
    console.log(`UPI Collector listening on http://${HOST}:${PORT}`);
  });

  process.on('unhandledRejection', (e) => {
    console.error(e);
  });
}).catch((e) => {
  console.error('Failed to initialize database:', e);
  process.exit(1);
});

module.exports = { app };
