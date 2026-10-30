import http from 'node:http';
import { URL } from 'node:url';
import { createLogger, LEVELS, getInternalServiceToken, safeEqual } from '@youpi/common';
import { isIP } from 'node:net';

export function resolveClientIp(req){
  const remote=(req.socket?.remoteAddress||'unknown').replace(/^::ffff:/,'');
  const trusted=['127.0.0.1','::1'].includes(remote)&&safeEqual(String(req.headers['x-gateway-token']||''),getInternalServiceToken());
  const forwarded=req.headers['cf-connecting-ip'];
  return trusted&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:remote;
}

const log = createLogger('http-server');

export { createLogger, LEVELS, log };

/** Security headers applied to every response emitted by the gateway. */
const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
});

/**
 * Lightweight, high-performance HTTP router and server with native SSE and CORS.
 */
export class HttpServer {
  constructor(options = {}) {
    this.routes = [];
    this.guards = [];
    this.sseClients = new Map(); // sessionId -> Set of res objects

    // Rate limiting: in-memory, IP-based fixed window
    // Gaming-industry defaults: high throughput for concurrent payment requests
    const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
    const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 1000);
    this._rateLimitWindowMs = windowMs;
    this._rateLimitMaxRequests = maxRequests;
    this._rateLimitHits = new Map(); // ip -> { count, resetAt }
    this._rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false';

    // Cleanup old rate limit entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of this._rateLimitHits.entries()) {
        if (now > entry.resetAt) {
          this._rateLimitHits.delete(ip);
        }
      }
    }, 300000).unref();
  }

  /**
   * Registers a route.
   * @param {'GET'|'POST'|'PUT'|'DELETE'} method
   * @param {string} pattern E.g. "/api/v1/checkout/:id/state"
   * @param {(req: any, res: any, params: Record<string, string>) => void} handler
   */
  register(method, pattern, handler) {
    const paramNames = [];
    const regexPattern = pattern.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });

    this.routes.push({
      method: method.toUpperCase(),
      regex: new RegExp(`^${regexPattern}$`),
      paramNames,
      handler
    });
  }

  /**
   * Registers a guard that runs before routing. Return true when the guard has
   * already answered the request (e.g. 401), so no route handler runs.
   * @param {(req: any, res: any, pathname: string, url: URL) => boolean|Promise<boolean>} guard
   */
  use(guard) {
    this.guards.push(guard);
  }

  get(pattern, handler) {
    this.register('GET', pattern, handler);
  }

  post(pattern, handler) {
    this.register('POST', pattern, handler);
  }

  delete(pattern, handler) {
    this.register('DELETE', pattern, handler);
  }

  /**
   * Rate limit check for an IP address. Returns { allowed, remaining, resetAt }.
   */
  checkRateLimit(ip) {
    if (!this._rateLimitEnabled) return { allowed: true, remaining: -1, resetAt: 0 };

    const now = Date.now();
    let entry = this._rateLimitHits.get(ip);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this._rateLimitWindowMs };
      this._rateLimitHits.set(ip, entry);
    }

    entry.count++;
    const remaining = Math.max(0, this._rateLimitMaxRequests - entry.count);
    const allowed = entry.count <= this._rateLimitMaxRequests;

    return { allowed, remaining, resetAt: entry.resetAt };
  }

  /**
   * Dispatches SSE event to all connected clients listening on a specific topic/key.
   * @param {string} topic
   * @param {string} event
   * @param {any} data
   */
  broadcastSse(topic, event, data) {
    const clients = this.sseClients.get(topic);
    if (!clients || clients.size === 0) return;

    const safeJson = (obj) => JSON.stringify(obj, (k, v) => typeof v === 'bigint' ? v.toString() : v);
    const namedPayload = `event: ${event}\ndata: ${safeJson(data)}\n\n`;
    const defaultPayload = `data: ${safeJson({ type: event, ...data, event })}\n\n`;
    const combinedPayload = namedPayload + defaultPayload;
    for (const res of clients) {
      try {
        res.write(combinedPayload);
      } catch {
        clients.delete(res);
      }
    }
  }

  /**
   * Sets up SSE connection for a client response.
   * @param {string} topic
   * @param {http.ServerResponse} res
   */
  initSse(topic, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      ...BASE_SECURITY_HEADERS
    });

    res.write('event: connected\ndata: {"status":"connected"}\n\n');

    if (!this.sseClients.has(topic)) {
      this.sseClients.set(topic, new Set());
    }
    const set = this.sseClients.get(topic);
    set.add(res);

    // Keepalive ping every 15s
    const pingInterval = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(pingInterval);
      }
    }, 15000);

    res.on('close', () => {
      clearInterval(pingInterval);
      set.delete(res);
      if (set.size === 0) {
        this.sseClients.delete(topic);
      }
    });
  }

  /**
   * Helper to send JSON responses with standard headers.
   */
  static json(res, statusCode, data) {
    const jsonStr = JSON.stringify(data, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-Device-Id, X-Timestamp, X-Signature',
      ...BASE_SECURITY_HEADERS
    });
    res.end(jsonStr);
  }

  /**
   * Parses JSON body from request.
   */
  static async parseBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalLength = 0;
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        chunks.push(Buffer.from(chunk));
        totalLength += chunk.length;
        if (totalLength > 2 * 1024 * 1024) { // 2MB limit
          tooLarge = true;
          reject(new Error('Payload Too Large'));
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        const body = Buffer.concat(chunks).toString('utf8');
        if (!body.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Malformed JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Reads raw string body from request for HMAC signature verification.
   */
  static async parseRawBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        body += chunk;
        if (body.length > 2 * 1024 * 1024) {
          tooLarge = true;
          body = '';
          reject(new Error('Payload Too Large'));
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        resolve(body);
      });
      req.on('error', reject);
    });
  }

  /**
   * Creates native HTTP server.
   */
  createServer() {
    return http.createServer(async (req, res) => {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-Device-Id, X-Timestamp, X-Signature',
          ...BASE_SECURITY_HEADERS
        });
        res.end();
        return;
      }

      let parsedUrl;
      try {
        // Fixed base: the Host header is attacker-controlled and can make URL parsing throw.
        parsedUrl = new URL(req.url, 'http://localhost');
      } catch {
        HttpServer.json(res, 400, { error: 'Malformed request URL' });
        return;
      }
      const pathname = parsedUrl.pathname;
      const method = req.method.toUpperCase();

      // Extract client IP for rate limiting
      const clientIp = resolveClientIp(req);

      // Structured request log
      const startTime = Date.now();
      log.info(`${method} ${pathname}`, { ip: clientIp, method, path: pathname });

      // Rate limiting check (skip health checks and SSE)
      const isHealthOrSse = pathname === '/health' || pathname === '/api/v1/health' || pathname.startsWith('/events');
      if (!isHealthOrSse) {
        const rateLimit = this.checkRateLimit(clientIp);
        if (!rateLimit.allowed) {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000) || '1',
            ...BASE_SECURITY_HEADERS
          });
          res.end(JSON.stringify({ error: 'Too many requests', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) || 1 }));
          log.warn('Rate limit exceeded', { ip: clientIp, method, path: pathname, remaining: rateLimit.remaining });
          return;
        }
      }

      try {
        for (const guard of this.guards) {
          if (await guard(req, res, pathname, parsedUrl)) return;
        }
      } catch (err) {
        log.error(`Guard Error [${method} ${pathname}]:`, { err: err.message, ip: clientIp, method, path: pathname });
        HttpServer.json(res, 500, { error: 'Internal Server Error' });
        return;
      }

      for (const route of this.routes) {
        if (route.method === method) {
          const match = pathname.match(route.regex);
          if (match) {
            const params = {};
            route.paramNames.forEach((name, index) => {
              params[name] = match[index + 1];
            });

            req.query = Object.fromEntries(parsedUrl.searchParams.entries());

            try {
              await route.handler(req, res, params);
              const duration = Date.now() - startTime;
              log.info(`${method} ${pathname} completed`, { ip: clientIp, method, path: pathname, durationMs: duration });
            } catch (err) {
              const duration = Date.now() - startTime;
              // Log the detail server-side; never echo stack/SQL text to an anonymous caller.
              log.error(`Route Error [${method} ${pathname}]:`, { err: err.message, ip: clientIp, method, path: pathname, durationMs: duration });
              HttpServer.json(res, 500, { error: 'Internal Server Error' });
            }
            return;
          }
        }
      }

      // Not found
      HttpServer.json(res, 404, { error: `Route not found: ${method} ${pathname}` });
    });
  }
}
