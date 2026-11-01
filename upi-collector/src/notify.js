'use strict';

const https = require('https');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { run: dbRun, log: dbLog } = require('./db');

const QUEUE = [];
let PROCESSING = false;

function enqueue(item) {
  QUEUE.push(item);
  if (!PROCESSING) {
    setImmediate(processQueue);
  }
}

async function processQueue() {
  if (PROCESSING) return;
  PROCESSING = true;
  while (QUEUE.length > 0) {
    const item = QUEUE.shift();
    try {
      await handleItem(item);
    } catch (e) {
      dbLog('error', 'queue item failed', { error: e.message });
    }
  }
  PROCESSING = false;
}

async function handleItem(item) {
  switch (item.type) {
    case 'ntfy':
      await sendNtfy(item.topic, item.message, item.tags);
      break;
    case 'email':
      await sendEmail(item.to, item.subject, item.text, item.html);
      break;
    default:
      dbLog('warn', 'unknown queue item type', { type: item.type });
  }
}

async function sendNtfy(topic, message, tags = []) {
  if (!topic) return;
  const payload = JSON.stringify({ message, tags });
  await new Promise((resolve, reject) => {
    const req = https.request(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    });
    req.on('error', reject);
    req.on('response', (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`ntfy HTTP ${res.statusCode}`));
    });
    req.write(payload);
    req.end();
  });
}

let gmailTransporter = null;

async function getGmailTransporter() {
  if (gmailTransporter) return gmailTransporter;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const accessToken = await oauth2Client.getAccessToken();

  gmailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.GMAIL_FROM || '',
      clientId,
      clientSecret,
      refreshToken,
      accessToken: accessToken.token,
    },
  });
  return gmailTransporter;
}

async function sendEmail(to, subject, text, html) {
  const transporter = await getGmailTransporter();
  if (!transporter) {
    dbLog('warn', 'email skipped: gmail credentials not configured', { to, subject });
    return;
  }
  await transporter.sendMail({
    from: process.env.GMAIL_FROM || '"UPI Collector" <no-reply@example.com>',
    to,
    subject,
    text,
    html,
  });
}

function alertMerchant(order, smsEvent) {
  const topic = process.env.NTFY_TOPIC;
  const message = `UPI payment received!\nOrder: ${order.order_id}\nAmount: ₹${order.amount}\nUTR: ${smsEvent.utr}\nSender: ${smsEvent.sender}`;
  enqueue({ type: 'ntfy', topic, message, tags: ['upi', 'payment'] });

  if (order.payer_email) {
    enqueue({
      type: 'email',
      to: order.payer_email,
      subject: `Payment received for order ${order.order_id}`,
      text: `We received ₹${order.amount} (UTR: ${smsEvent.utr}) for order ${order.order_id}.`,
      html: `<p>We received ₹${order.amount} (UTR: <b>${smsEvent.utr}</b>) for order <b>${order.order_id}</b>.</p>`,
    });
  }
}

module.exports = { enqueue, alertMerchant, sendNtfy, sendEmail, queueDepth: () => QUEUE.length };
