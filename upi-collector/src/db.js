'use strict';

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = process.env.SQLITE_PATH || path.join(DATA_DIR, 'upi_collector.sqlite');

let _db = null;

async function initDb() {
  _db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });
  await _db.exec('PRAGMA journal_mode = WAL');
  await _db.exec('PRAGMA foreign_keys = ON');
  await migrate();
  return _db;
}

function db() {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

async function run(sql, params = []) {
  return _db.run(sql, params);
}
async function get(sql, params = []) {
  return _db.get(sql, params);
}
async function all(sql, params = []) {
  return _db.all(sql, params);
}

async function migrate() {
  await _db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      device_key TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      payer_email TEXT,
      payer_phone TEXT,
      upi_note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      paid_sms INTEGER NOT NULL DEFAULT 0,
      paid_verified INTEGER NOT NULL DEFAULT 0,
      matched_sms_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sms_events (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL,
      ts TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      parsed INTEGER NOT NULL DEFAULT 0,
      amount TEXT,
      utr TEXT,
      vpa TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      matched_order_id TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

async function log(level, message, meta = null) {
  try {
    await run('INSERT INTO logs (level, message, meta, created_at) VALUES (?, ?, ?, datetime("now"))', [level, message, meta ? JSON.stringify(meta) : null]);
  } catch (e) {
    // never let logging break the app
  }
}

process.on('beforeExit', async () => {
  if (_db) await _db.close();
});

module.exports = { initDb, db, run, get, all, log, migrate };
