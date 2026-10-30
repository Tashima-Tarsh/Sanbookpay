/**
 * Structured JSON logger for YOUPI PG production use.
 * Outputs newline-delimited JSON (NDJSON) suitable for log aggregation.
 * No external dependencies - uses node:console only.
 */
const LEVELS = Object.freeze({
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50
});

const LEVEL_NAMES = Object.freeze({
  10: 'debug',
  20: 'info',
  30: 'warn',
  40: 'error',
  50: 'fatal'
});

let minLevel = LEVELS.INFO;
try {
  const envLevel = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
  if (LEVELS[envLevel] !== undefined) minLevel = LEVELS[envLevel];
} catch {}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, (key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (typeof val === 'symbol') return val.toString();
      return val;
    });
  } catch {
    return String(value);
  }
}

export function createLogger(component = 'youpi-pg') {
  return {
    debug(msg, meta = {}) {
      if (minLevel > LEVELS.DEBUG) return;
      write(component, LEVELS.DEBUG, msg, meta);
    },
    info(msg, meta = {}) {
      if (minLevel > LEVELS.INFO) return;
      write(component, LEVELS.INFO, msg, meta);
    },
    warn(msg, meta = {}) {
      if (minLevel > LEVELS.WARN) return;
      write(component, LEVELS.WARN, msg, meta);
    },
    error(msg, meta = {}) {
      if (minLevel > LEVELS.ERROR) return;
      write(component, LEVELS.ERROR, msg, meta);
    },
    fatal(msg, meta = {}) {
      write(component, LEVELS.FATAL, msg, meta);
    },
    child(childMeta) {
      return createLoggerWithChild(component, childMeta);
    }
  };
}

function createLoggerWithChild(component, childMeta) {
  return {
    debug(msg, meta = {}) {
      if (minLevel > LEVELS.DEBUG) return;
      write(component, LEVELS.DEBUG, msg, { ...childMeta, ...meta });
    },
    info(msg, meta = {}) {
      if (minLevel > LEVELS.INFO) return;
      write(component, LEVELS.INFO, msg, { ...childMeta, ...meta });
    },
    warn(msg, meta = {}) {
      if (minLevel > LEVELS.WARN) return;
      write(component, LEVELS.WARN, msg, { ...childMeta, ...meta });
    },
    error(msg, meta = {}) {
      if (minLevel > LEVELS.ERROR) return;
      write(component, LEVELS.ERROR, msg, { ...childMeta, ...meta });
    },
    fatal(msg, meta = {}) {
      write(component, LEVELS.FATAL, msg, { ...childMeta, ...meta });
    }
  };
}

function write(component, level, msg, meta) {
  const entry = {
    level: LEVEL_NAMES[level],
    msg,
    timestamp: new Date().toISOString(),
    component,
    pid: process.pid,
    ...(isObject(meta) ? meta : { meta })
  };
  const line = safeStringify(entry);
  if (level >= LEVELS.ERROR) {
    console.error(line);
  } else {
    console.log(line);
  }
}

export { LEVELS };
