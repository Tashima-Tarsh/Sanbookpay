import crypto from 'node:crypto';
import { HttpServer } from '../server.js';
import { hashPassword, verifyPassword, generateRandomToken, safeEqual, encryptAtRest } from '@youpi/common';

/**
 * Super Admin Authentication & RBAC Routes
 * Dedicated authentication system for Platform Owner and platform staff.
 * Completely separate from merchant and customer authentication.
 */
export function registerSuperAdminRoutes(server, ctx) {
  const { superAdminRepo, roleRepo, mfaRepo, auditRepo } = ctx;

  const SESSION_TTL_MS = Number(process.env.SUPER_ADMIN_SESSION_TTL_MS || 86400000); // 24 hours
  const SUPER_ADMIN_PREFIX = '/api/v1/super-admin';

  function clientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  }

  function logAudit(superAdminId, action, entityType, entityId, details, req) {
    try {
      auditRepo.log({
        merchantId: null,
        entityType,
        entityId: entityId || '',
        action,
        actorType: 'SUPER_ADMIN',
        actorId: superAdminId || '',
        details: JSON.stringify({ ...details, ip: clientIp(req) }),
        ip_address: clientIp(req)
      });
    } catch {}
  }

  // POST /api/v1/super-admin/login
  server.post(`${SUPER_ADMIN_PREFIX}/login`, async (req, res) => {
    const body = await HttpServer.parseBody(req);
    const { email, password, mfaToken } = body;

    if (!email || !password) {
      HttpServer.json(res, 400, { error: 'Email and password are required', code: 'MISSING_CREDENTIALS' });
      return;
    }

    const admin = superAdminRepo.findByEmail(email);
    if (!admin) {
      HttpServer.json(res, 401, { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      return;
    }

    if (admin.status !== 'ACTIVE') {
      HttpServer.json(res, 403, { error: 'Account is not active', code: 'ACCOUNT_INACTIVE' });
      return;
    }

    const passwordValid = verifyPassword(password, admin.passwordHash);
    if (!passwordValid) {
      HttpServer.json(res, 401, { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      return;
    }

    // MFA check
    if (admin.mfaEnabled) {
      if (!mfaToken) {
        HttpServer.json(res, 401, { error: 'MFA token required', code: 'MFA_REQUIRED', requiresMfa: true });
        return;
      }

      const mfa = mfaRepo.findChallengeByUser('SUPER_ADMIN', admin.id);
      if (!mfa || !mfa.isVerified) {
        HttpServer.json(res, 401, { error: 'MFA not enrolled', code: 'MFA_NOT_ENROLLED' });
        return;
      }

      // Verify TOTP token (simple HMAC-based verification)
      try {
        const secret = require('@youpi/common').decrypt(mfa.secretEncrypted, process.env.ENCRYPTION_MASTER_KEY || 'dev');
        // Simple TOTP verification
        const timeStep = Math.floor(Date.now() / 1000 / 30);
        const expectedToken = crypto
          .createHmac('sha256', secret)
          .update(String(timeStep))
          .digest('hex')
          .substring(0, 6);
        if (!safeEqual(mfaToken, expectedToken)) {
          HttpServer.json(res, 401, { error: 'Invalid MFA token', code: 'INVALID_MFA_TOKEN' });
          return;
        }
      } catch {
        HttpServer.json(res, 500, { error: 'MFA verification error', code: 'MFA_ERROR' });
        return;
      }
    }

    // Create session
    const token = generateRandomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    const session = superAdminRepo.createSession({
      superAdminId: admin.id,
      token,
      expiresAt,
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null
    });

    superAdminRepo.update(admin.id, { lastLoginAt: new Date().toISOString() });

    logAudit(admin.id, 'SUPER_ADMIN_LOGIN', 'SUPER_ADMIN_SESSION', session.id, { email: admin.email }, req);

    HttpServer.json(res, 200, {
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      admin: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
        mfaEnabled: admin.mfaEnabled
      }
    });
  });

  // POST /api/v1/super-admin/logout
  server.post(`${SUPER_ADMIN_PREFIX}/logout`, async (req, res) => {
    const body = await HttpServer.parseBody(req);
    const { token } = body;

    const presented = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(presented);
    const sessionToken = token || (match ? match[1] : '');

    if (sessionToken) {
      superAdminRepo.revokeSession(sessionToken);
      // Try to get admin id from session for audit
      const session = superAdminRepo.findSessionByToken(sessionToken);
      if (session) {
        logAudit(session.admin.id, 'SUPER_ADMIN_LOGOUT', 'SUPER_ADMIN_SESSION', session.id, {}, req);
      }
    }

    HttpServer.json(res, 200, { success: true, message: 'Logged out' });
  });

  // GET /api/v1/super-admin/sessions - List active sessions
  server.get(`${SUPER_ADMIN_PREFIX}/sessions`, async (req, res) => {
    const presented = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(presented);
    const token = match ? match[1] : '';

    const session = superAdminRepo.findSessionByToken(token);
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const sessions = superAdminRepo.findActiveSessionsForAdmin(session.admin.id);
    HttpServer.json(res, 200, { sessions });
  });

  // DELETE /api/v1/super-admin/sessions/:id - Revoke session
  server.delete(`${SUPER_ADMIN_PREFIX}/sessions/:id`, async (req, res, params) => {
    const presented = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(presented);
    const token = match ? match[1] : '';

    const session = superAdminRepo.findSessionByToken(token);
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    // Find the session to revoke by token lookup since we have session id
    const allSessions = superAdminRepo.findActiveSessionsForAdmin(session.admin.id);
    const target = allSessions.find(s => s.id === params.id);
    if (!target) {
      HttpServer.json(res, 404, { error: 'Session not found', code: 'NOT_FOUND' });
      return;
    }

    superAdminRepo.revokeSession(target.token);
    logAudit(session.admin.id, 'SUPER_ADMIN_SESSION_REVOKED', 'SUPER_ADMIN_SESSION', params.id, {}, req);

    HttpServer.json(res, 200, { success: true, message: 'Session revoked' });
  });

  // POST /api/v1/super-admin/mfa/enroll - Start MFA enrollment
  server.post(`${SUPER_ADMIN_PREFIX}/mfa/enroll`, async (req, res) => {
    const presented = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(presented);
    const token = match ? match[1] : '';

    const session = superAdminRepo.findSessionByToken(token);
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const { encrypt } = require('@youpi/common');
    const masterKey = process.env.ENCRYPTION_MASTER_KEY || 'dev';
    const secret = crypto.randomBytes(20).toString('base64');
    const encryptedSecret = encrypt(secret, masterKey);

    // Generate recovery codes
    const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex'));

    const existing = mfaRepo.findChallengeByUser('SUPER_ADMIN', session.admin.id);
    if (existing) {
      mfaRepo.updateChallenge(existing.id, {
        secretEncrypted: encryptedSecret,
        isVerified: false,
        recoveryCodes: JSON.stringify(recoveryCodes)
      });
    } else {
      mfaRepo.createChallenge({
        userType: 'SUPER_ADMIN',
        userId: session.admin.id,
        secretEncrypted: encryptedSecret,
        isVerified: false,
        recoveryCodes: JSON.stringify(recoveryCodes)
      });
    }

    logAudit(session.admin.id, 'MFA_ENROLLMENT_STARTED', 'MFA_CHALLENGE', session.admin.id, {}, req);

    HttpServer.json(res, 200, {
      success: true,
      secret, // Return plaintext once for QR code setup
      recoveryCodes,
      message: 'Scan the QR code with your authenticator app. Verify with a token to complete enrollment.'
    });
  });

  // POST /api/v1/super-admin/mfa/verify - Verify MFA token to complete enrollment
  server.post(`${SUPER_ADMIN_PREFIX}/mfa/verify`, async (req, res) => {
    const body = await HttpServer.parseBody(req);
    const { token: mfaToken } = body;

    const presented = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(presented);
    const token = match ? match[1] : '';

    const session = superAdminRepo.findSessionByToken(token);
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const mfa = mfaRepo.findChallengeByUser('SUPER_ADMIN', session.admin.id);
    if (!mfa) {
      HttpServer.json(res, 400, { error: 'No MFA enrollment in progress', code: 'NO_ENROLLMENT' });
      return;
    }

    try {
      const { decrypt } = require('@youpi/common');
      const secret = decrypt(mfa.secretEncrypted, process.env.ENCRYPTION_MASTER_KEY || 'dev');
      const timeStep = Math.floor(Date.now() / 1000 / 30);
      const expectedToken = crypto
        .createHmac('sha256', secret)
        .update(String(timeStep))
        .digest('hex')
        .substring(0, 6);

      if (!safeEqual(mfaToken, expectedToken)) {
        HttpServer.json(res, 401, { error: 'Invalid MFA token', code: 'INVALID_MFA_TOKEN' });
        return;
      }

      mfaRepo.updateChallenge(mfa.id, { isVerified: true });
      superAdminRepo.update(session.admin.id, { mfaEnabled: true });

      logAudit(session.admin.id, 'MFA_ENROLLMENT_COMPLETED', 'MFA_CHALLENGE', session.admin.id, {}, req);

      HttpServer.json(res, 200, { success: true, message: 'MFA enrolled successfully' });
    } catch {
      HttpServer.json(res, 500, { error: 'MFA verification error', code: 'MFA_ERROR' });
    }
  });

  // GET /api/v1/super-admin/verify-session - Verify current session
  server.get(`${SUPER_ADMIN_PREFIX}/verify-session`, async (req, res) => {
    const presented = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(presented);
    const token = match ? match[1] : '';

    if (!token) {
      HttpServer.json(res, 401, { error: 'No session token', code: 'NO_SESSION' });
      return;
    }

    const session = superAdminRepo.findSessionByToken(token);
    if (!session) {
      HttpServer.json(res, 401, { error: 'Invalid or expired session', code: 'INVALID_SESSION' });
      return;
    }

    // Check expiry
    if (new Date(session.expiresAt) <= new Date()) {
      superAdminRepo.revokeSession(token);
      HttpServer.json(res, 401, { error: 'Session expired', code: 'SESSION_EXPIRED' });
      return;
    }

    HttpServer.json(res, 200, {
      valid: true,
      admin: {
        id: session.admin.id,
        email: session.admin.email,
        fullName: session.admin.fullName,
        role: session.admin.role,
        mfaEnabled: session.admin.mfaEnabled
      },
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent
      }
    });
  });

  // POST /api/v1/super-admin/change-password
  server.post(`${SUPER_ADMIN_PREFIX}/change-password`, async (req, res) => {
    const body = await HttpServer.parseBody(req);
    const { currentPassword, newPassword } = body;

    const presented = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(presented);
    const token = match ? match[1] : '';

    const session = superAdminRepo.findSessionByToken(token);
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    if (!currentPassword || !newPassword) {
      HttpServer.json(res, 400, { error: 'Current and new password required', code: 'MISSING_PASSWORD' });
      return;
    }

    const admin = superAdminRepo.findById(session.admin.id);
    if (!verifyPassword(currentPassword, admin.passwordHash)) {
      HttpServer.json(res, 401, { error: 'Current password is incorrect', code: 'INVALID_CURRENT_PASSWORD' });
      return;
    }

    superAdminRepo.update(admin.id, { passwordHash: hashPassword(newPassword) });

    // Revoke all other sessions
    superAdminRepo.revokeAllSessionsForAdmin(admin.id);

    logAudit(admin.id, 'PASSWORD_CHANGED', 'SUPER_ADMIN', admin.id, {}, req);

    HttpServer.json(res, 200, { success: true, message: 'Password changed. All other sessions revoked.' });
  });

  // ============ MERCHANT MANAGEMENT ============

  // POST /api/v1/super-admin/merchants - Create a new merchant
  server.post(`${SUPER_ADMIN_PREFIX}/merchants`, async (req, res) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const {
      businessName, displayName, category, website, contactEmail, contactPhone,
      address, status, internalNotes
    } = body;

    if (!businessName || !contactEmail || !contactPhone) {
      HttpServer.json(res, 400, { error: 'businessName, contactEmail, and contactPhone are required', code: 'MISSING_FIELDS' });
      return;
    }

    // Check for duplicate email
    const existing = ctx.merchantRepo.findAll().find(m => m.contactEmail === contactEmail);
    if (existing) {
      HttpServer.json(res, 409, { error: 'Merchant with this email already exists', code: 'DUPLICATE_EMAIL' });
      return;
    }

    const merchantId = crypto.randomUUID();
    const slug = (displayName || businessName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    const merchant = ctx.merchantRepo.create({
      id: merchantId,
      businessName,
      slug,
      contactEmail,
      contactPhone,
      webhookUrl: null,
      webhookSecret: crypto.randomBytes(32).toString('hex'),
      branding: {
        appName: businessName,
        primaryColor: '#059669',
        logoUrl: null,
        category,
        website,
        address,
        internalNotes,
        status: status || 'ACTIVE'
      }
    });

    logAudit(session.admin.id, 'MERCHANT_CREATED', 'MERCHANT', merchant.id, {
      businessName, slug, contactEmail, status: status || 'ACTIVE'
    }, req);

    HttpServer.json(res, 201, {
      success: true,
      merchantId: merchant.id,
      slug: merchant.slug,
      businessName: merchant.businessName,
      message: 'Merchant created successfully'
    });
  });

  // GET /api/v1/super-admin/merchants - List all merchants
  server.get(`${SUPER_ADMIN_PREFIX}/merchants`, async (req, res) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session) {
      HttpServer.json(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const merchants = ctx.merchantRepo.findAll().map(m => {
      const accounts = ctx.accountRepo ? ctx.accountRepo.findByMerchantId(m.id) : [];
      return {
        id: m.id,
        businessName: m.businessName,
        slug: m.slug,
        contactEmail: m.contactEmail,
        contactPhone: m.contactPhone,
        status: m.branding?.status || 'ACTIVE',
        category: m.branding?.category || '',
        website: m.branding?.website || '',
        webhookUrl: m.webhookUrl || '',
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        receivingAccounts: accounts.length,
        activeRoutes: accounts.filter(a => a.isActive).length
      };
    });

    HttpServer.json(res, 200, { merchants, total: merchants.length });
  });

  // GET /api/v1/super-admin/merchants/:id - Get merchant details
  server.get(`${SUPER_ADMIN_PREFIX}/merchants/:id`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session) {
      HttpServer.json(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const merchant = ctx.merchantRepo.findById(params.id);
    if (!merchant) {
      HttpServer.json(res, 404, { error: 'Merchant not found', code: 'NOT_FOUND' });
      return;
    }

    const accounts = ctx.accountRepo ? ctx.accountRepo.findByMerchantId(merchant.id) : [];
    const users = ctx.merchantUserRepo ? ctx.merchantUserRepo.findByMerchantId(merchant.id) : [];

    HttpServer.json(res, 200, {
      merchant: {
        id: merchant.id,
        businessName: merchant.businessName,
        slug: merchant.slug,
        contactEmail: merchant.contactEmail,
        contactPhone: merchant.contactPhone,
        status: merchant.branding?.status || 'ACTIVE',
        category: merchant.branding?.category || '',
        website: merchant.branding?.website || '',
        address: merchant.branding?.address || '',
        internalNotes: merchant.branding?.internalNotes || '',
        webhookUrl: merchant.webhookUrl || '',
        branding: merchant.branding,
        createdAt: merchant.createdAt,
        updatedAt: merchant.updatedAt
      },
      receivingAccounts: accounts.map(a => ({
        id: a.id,
        upiId: a.upiId,
        payeeName: a.payeeName,
        isActive: a.isActive,
        isSlotBusy: a.isSlotBusy,
        createdAt: a.createdAt
      })),
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        status: u.status,
        mfaEnabled: u.mfaEnabled,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt
      }))
    });
  });

  // PUT /api/v1/super-admin/merchants/:id - Update merchant
  server.register('PUT', `${SUPER_ADMIN_PREFIX}/merchants/:id`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const merchant = ctx.merchantRepo.findById(params.id);
    if (!merchant) {
      HttpServer.json(res, 404, { error: 'Merchant not found', code: 'NOT_FOUND' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const updates = {};
    if (body.businessName !== undefined) updates.businessName = body.businessName;
    if (body.contactEmail !== undefined) updates.contactEmail = body.contactEmail;
    if (body.contactPhone !== undefined) updates.contactPhone = body.contactPhone;

    if (body.branding) {
      const currentBranding = merchant.branding || {};
      updates.branding = { ...currentBranding, ...body.branding };
    }

    const updated = ctx.merchantRepo.update(params.id, updates);

    logAudit(session.admin.id, 'MERCHANT_UPDATED', 'MERCHANT', params.id, { updates }, req);

    HttpServer.json(res, 200, { success: true, merchant: updated });
  });

  // POST /api/v1/super-admin/merchants/:id/suspend - Suspend merchant
  server.post(`${SUPER_ADMIN_PREFIX}/merchants/:id/suspend`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const merchant = ctx.merchantRepo.findById(params.id);
    if (!merchant) {
      HttpServer.json(res, 404, { error: 'Merchant not found', code: 'NOT_FOUND' });
      return;
    }

    const branding = { ...(merchant.branding || {}), status: 'SUSPENDED', suspendReason: body.reason || 'Suspended by Platform Owner' };
    const updated = ctx.merchantRepo.update(params.id, { branding });

    // Revoke all merchant user sessions
    if (ctx.merchantUserRepo) {
      const users = ctx.merchantUserRepo.findByMerchantId(params.id);
      for (const u of users) {
        ctx.merchantUserRepo.revokeAllSessionsForUser(u.id);
      }
    }

    logAudit(session.admin.id, 'MERCHANT_SUSPENDED', 'MERCHANT', params.id, { reason: body.reason }, req);

    HttpServer.json(res, 200, { success: true, merchant: updated });
  });

  // POST /api/v1/super-admin/merchants/:id/activate - Activate merchant
  server.post(`${SUPER_ADMIN_PREFIX}/merchants/:id/activate`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const merchant = ctx.merchantRepo.findById(params.id);
    if (!merchant) {
      HttpServer.json(res, 404, { error: 'Merchant not found', code: 'NOT_FOUND' });
      return;
    }

    const branding = { ...(merchant.branding || {}), status: 'ACTIVE' };
    const updated = ctx.merchantRepo.update(params.id, { branding });

    logAudit(session.admin.id, 'MERCHANT_ACTIVATED', 'MERCHANT', params.id, {}, req);

    HttpServer.json(res, 200, { success: true, merchant: updated });
  });

  // ============ MERCHANT USER MANAGEMENT ============

  // GET /api/v1/super-admin/merchants/:id/users - List merchant users
  server.get(`${SUPER_ADMIN_PREFIX}/merchants/:id/users`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session) {
      HttpServer.json(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    if (!ctx.merchantUserRepo) {
      HttpServer.json(res, 200, { users: [] });
      return;
    }

    const users = ctx.merchantUserRepo.findByMerchantId(params.id).map(u => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      status: u.status,
      mfaEnabled: u.mfaEnabled,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt
    }));

    HttpServer.json(res, 200, { users, total: users.length });
  });

  // POST /api/v1/super-admin/merchants/:id/users - Create merchant user
  server.post(`${SUPER_ADMIN_PREFIX}/merchants/:id/users`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    if (!ctx.merchantUserRepo) {
      HttpServer.json(res, 500, { error: 'Merchant user repository not available', code: 'SYSTEM_ERROR' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const { email, password, fullName, role } = body;

    if (!email || !password || !fullName) {
      HttpServer.json(res, 400, { error: 'email, password, and fullName are required', code: 'MISSING_FIELDS' });
      return;
    }

    const existing = ctx.merchantUserRepo.findByEmailAndMerchant(email, params.id);
    if (existing) {
      HttpServer.json(res, 409, { error: 'User with this email already exists in this merchant', code: 'DUPLICATE_EMAIL' });
      return;
    }

    const user = ctx.merchantUserRepo.create({
      merchantId: params.id,
      email,
      passwordHash: hashPassword(password),
      fullName,
      role: role || 'MERCHANT_VIEWER',
      status: 'ACTIVE'
    });

    // Assign default role if roleRepo available
    if (ctx.roleRepo) {
      const roleObj = ctx.roleRepo.findByName(role || 'MERCHANT_VIEWER');
      if (roleObj) {
        ctx.roleRepo.assignRoleToMerchantUser(user.id, roleObj.id);
      }
    }

    logAudit(session.admin.id, 'MERCHANT_USER_CREATED', 'MERCHANT_USER', user.id, {
      merchantId: params.id, email, role: user.role
    }, req);

    HttpServer.json(res, 201, {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status
      },
      message: 'Merchant user created. Share credentials securely via activation link.'
    });
  });

  // ============ RECEIVING BANK & UPI MANAGEMENT ============

  // GET /api/v1/super-admin/receiving-banks - List all receiving bank connections across merchants
  server.get(`${SUPER_ADMIN_PREFIX}/receiving-banks`, async (req, res) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session) {
      HttpServer.json(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const connections = ctx.db.query(
      `SELECT pc.*, m.business_name as merchant_name, m.slug as merchant_slug
       FROM provider_connections pc
       JOIN merchants m ON pc.merchant_id = m.id
       ORDER BY pc.created_at DESC`
    );

    HttpServer.json(res, 200, {
      connections: (connections || []).map(c => ({
        id: c.id,
        merchantId: c.merchant_id,
        merchantName: c.merchant_name,
        merchantSlug: c.merchant_slug,
        providerName: c.provider_name,
        environment: c.environment,
        businessMerchantId: c.business_merchant_id,
        merchantVpa: c.merchant_vpa,
        status: c.status,
        isActive: Boolean(c.is_active),
        lastTestedAt: c.last_tested_at,
        testResult: c.test_result,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      }))
    });
  });

  // POST /api/v1/super-admin/receiving-banks - Create a receiving bank connection
  server.post(`${SUPER_ADMIN_PREFIX}/receiving-banks`, async (req, res) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const { merchantId, providerName, environment, businessMerchantId, clientId, clientSecret,
      merchantVpa, webhookUrl, webhookSecret, approvedAccountId } = body;

    if (!merchantId || !providerName || !merchantVpa) {
      HttpServer.json(res, 400, { error: 'merchantId, providerName, and merchantVpa are required', code: 'MISSING_FIELDS' });
      return;
    }

    const merchant = ctx.merchantRepo.findById(merchantId);
    if (!merchant) {
      HttpServer.json(res, 404, { error: 'Merchant not found', code: 'NOT_FOUND' });
      return;
    }

    // Create payment receiving account (VPA/bank account)
    const receivingAccountId = crypto.randomUUID();
    const now = new Date().toISOString();

    ctx.db.execute(
      `INSERT INTO payment_receiving_accounts (id, merchant_id, upi_id, payee_name, is_merchant_enabled, is_active, is_slot_busy, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, 0, ?, ?)`,
      [receivingAccountId, merchantId, merchantVpa, merchant.businessName, now, now]
    );

    // Create provider connection (API credentials)
    const connectionId = crypto.randomUUID();

    ctx.db.execute(
      `INSERT INTO provider_connections (id, merchant_id, provider_name, environment, business_merchant_id,
       client_id, client_secret_encrypted, merchant_vpa, webhook_url, webhook_secret_encrypted,
       approved_account_id, status, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [connectionId, merchantId, providerName, environment || 'PRODUCTION', businessMerchantId || null,
       clientId || null, clientSecret ? encryptAtRest(clientSecret) : null, merchantVpa,
       webhookUrl || null, webhookSecret ? encryptAtRest(webhookSecret) : null,
       approvedAccountId || null, 'CONFIGURED', 1, now, now]
    );

    // Create routing rule linking the receiving account
    const ruleId = crypto.randomUUID();
    ctx.db.execute(
      `INSERT INTO routing_rules (id, merchant_id, receiving_account_id, priority, weight, is_enabled, is_primary,
       strategy, health_check_interval_sec, failure_threshold, recovery_probe_interval_sec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ruleId, merchantId, receivingAccountId, 100, 100, 1, 1, 'PRIORITY_BASED', 60, 3, 300, now, now]
    );

    // Create route health record
    const healthId = crypto.randomUUID();
    ctx.db.execute(
      `INSERT INTO route_health (id, routing_rule_id, status, success_rate, timeout_rate, error_rate,
       avg_latency_ms, circuit_breaker_state, consecutive_failures, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [healthId, ruleId, 'HEALTHY', 1, 0, 0, 0, 'CLOSED', 0, now, now]
    );

    logAudit(session.admin.id, 'RECEIVING_BANK_ADDED', 'PROVIDER_CONNECTION', connectionId, {
      merchantId, providerName, merchantVpa, environment, receivingAccountId
    }, req);

    HttpServer.json(res, 201, {
      success: true,
      connectionId,
      ruleId,
      message: 'Receiving bank connection added successfully'
    });
  });

  // GET /api/v1/super-admin/receiving-banks/:id - Get connection details
  server.get(`${SUPER_ADMIN_PREFIX}/receiving-banks/:id`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session) {
      HttpServer.json(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const connection = ctx.db.queryOne(
      `SELECT pc.*, m.business_name as merchant_name
       FROM provider_connections pc
       JOIN merchants m ON pc.merchant_id = m.id
       WHERE pc.id = ?`,
      [params.id]
    );

    if (!connection) {
      HttpServer.json(res, 404, { error: 'Connection not found', code: 'NOT_FOUND' });
      return;
    }

    const health = ctx.db.queryOne('SELECT * FROM route_health WHERE routing_rule_id = ?',
      [ctx.db.queryOne('SELECT id FROM routing_rules WHERE receiving_account_id = ?', [connection.approved_account_id])?.id]);

    const capabilities = ctx.db.query(
      'SELECT * FROM provider_capabilities WHERE connection_id = ?',
      [params.id]
    );

    HttpServer.json(res, 200, {
      connection: {
        id: connection.id,
        merchantId: connection.merchant_id,
        merchantName: connection.merchant_name,
        providerName: connection.provider_name,
        environment: connection.environment,
        businessMerchantId: connection.business_merchant_id,
        clientId: connection.client_id,
        merchantVpa: connection.merchant_vpa,
        approvedAccountId: connection.approved_account_id,
        webhookUrl: connection.webhook_url,
        status: connection.status,
        isActive: Boolean(connection.is_active),
        lastTestedAt: connection.last_tested_at,
        testResult: connection.test_result,
        createdAt: connection.created_at,
        updatedAt: connection.updated_at
      },
      health: health ? {
        status: health.status,
        successRate: health.success_rate,
        circuitBreakerState: health.circuit_breaker_state,
        consecutiveFailures: health.consecutive_failures,
        avgLatencyMs: health.avg_latency_ms
      } : null,
      capabilities: (capabilities || []).map(c => ({
        capabilityCode: c.capability_code,
        isEnabled: Boolean(c.is_enabled),
        verifiedAt: c.verified_at
      }))
    });
  });

  // POST /api/v1/super-admin/receiving-banks/:id/test - Test connection
  server.post(`${SUPER_ADMIN_PREFIX}/receiving-banks/:id/test`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const connection = ctx.db.queryOne('SELECT * FROM provider_connections WHERE id = ?', [params.id]);
    if (!connection) {
      HttpServer.json(res, 404, { error: 'Connection not found', code: 'NOT_FOUND' });
      return;
    }

    // Simulate connection test - in production this would call the provider's health endpoint
    const now = new Date().toISOString();
    const testResult = { status: 'HEALTHY', latencyMs: 45, testedAt: now };

    ctx.db.execute(
      'UPDATE provider_connections SET status = ?, last_tested_at = ?, test_result = ?, updated_at = ? WHERE id = ?',
      ['CONFIGURED', now, JSON.stringify(testResult), now, params.id]
    );

    // Update route health
    const rule = ctx.db.queryOne('SELECT id FROM routing_rules WHERE receiving_account_id = ?', [connection.approved_account_id]);
    if (rule) {
      ctx.db.execute(
        `UPDATE route_health SET status = 'HEALTHY', last_health_check_at = ?, consecutive_failures = 0,
         circuit_breaker_state = 'CLOSED', updated_at = ? WHERE routing_rule_id = ?`,
        [now, now, rule.id]
      );
    }

    logAudit(session.admin.id, 'RECEIVING_BANK_TESTED', 'PROVIDER_CONNECTION', params.id, { testResult }, req);

    HttpServer.json(res, 200, {
      success: true,
      testResult,
      message: 'Connection test successful'
    });
  });

  // PUT /api/v1/super-admin/receiving-banks/:id - Update connection
  server.register('PUT', `${SUPER_ADMIN_PREFIX}/receiving-banks/:id`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const connection = ctx.db.queryOne('SELECT * FROM provider_connections WHERE id = ?', [params.id]);
    if (!connection) {
      HttpServer.json(res, 404, { error: 'Connection not found', code: 'NOT_FOUND' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const fields = [];
    const values = [];

    const updatable = ['provider_name', 'environment', 'business_merchant_id', 'client_id', 'merchant_vpa',
      'webhook_url', 'approved_account_id', 'status', 'is_active'];
    const encryptFields = ['client_secret', 'webhook_secret'];

    for (const key of updatable) {
      const jsKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (body[jsKey] !== undefined) {
        fields.push(`${key} = $${fields.length + 1}`);
        values.push(body[jsKey]);
      }
    }
    for (const key of encryptFields) {
      const jsKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (body[jsKey] !== undefined) {
        fields.push(`${key}_encrypted = $${fields.length + 1}`);
        values.push(encryptAtRest(body[jsKey]));
      }
    }

    if (fields.length > 0) {
      fields.push(`updated_at = $${fields.length + 1}`);
      values.push(new Date().toISOString());
      values.push(params.id);
      ctx.db.execute(`UPDATE provider_connections SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    }

    logAudit(session.admin.id, 'RECEIVING_BANK_UPDATED', 'PROVIDER_CONNECTION', params.id, { updates: body }, req);

    HttpServer.json(res, 200, { success: true, message: 'Connection updated' });
  });

  // DELETE /api/v1/super-admin/receiving-banks/:id - Delete connection
  server.delete(`${SUPER_ADMIN_PREFIX}/receiving-banks/:id`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const connection = ctx.db.queryOne('SELECT * FROM provider_connections WHERE id = ?', [params.id]);
    if (!connection) {
      HttpServer.json(res, 404, { error: 'Connection not found', code: 'NOT_FOUND' });
      return;
    }

    ctx.db.execute('DELETE FROM provider_connections WHERE id = ?', [params.id]);
    ctx.db.execute('DELETE FROM routing_rules WHERE receiving_account_id = ?', [connection.approved_account_id]);
    ctx.db.execute('DELETE FROM route_health WHERE routing_rule_id IN (SELECT id FROM routing_rules WHERE receiving_account_id = ?)', [connection.approved_account_id]);

    logAudit(session.admin.id, 'RECEIVING_BANK_DELETED', 'PROVIDER_CONNECTION', params.id, {}, req);

    HttpServer.json(res, 200, { success: true, message: 'Connection deleted' });
  });

  // GET /api/v1/super-admin/receiving-banks/:id/routes - Get routing rules for a connection
  server.get(`${SUPER_ADMIN_PREFIX}/receiving-banks/:id/routes`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session) {
      HttpServer.json(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const connection = ctx.db.queryOne('SELECT * FROM provider_connections WHERE id = ?', [params.id]);
    if (!connection) {
      HttpServer.json(res, 404, { error: 'Connection not found', code: 'NOT_FOUND' });
      return;
    }

    const rules = ctx.db.query(
      'SELECT * FROM routing_rules WHERE receiving_account_id = ? ORDER BY priority ASC',
      [connection.approved_account_id]
    );

    HttpServer.json(res, 200, {
      routes: (rules || []).map(r => ({
        id: r.id,
        merchantId: r.merchant_id,
        receivingAccountId: r.receiving_account_id,
        priority: r.priority,
        weight: r.weight,
        minAmountPaise: r.min_amount_paise,
        maxAmountPaise: r.max_amount_paise,
        isEnabled: Boolean(r.is_enabled),
        isPrimary: Boolean(r.is_primary),
        strategy: r.strategy,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    });
  });

  // POST /api/v1/super-admin/receiving-banks/:id/routes - Add routing rule
  server.post(`${SUPER_ADMIN_PREFIX}/receiving-banks/:id/routes`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const connection = ctx.db.queryOne('SELECT * FROM provider_connections WHERE id = ?', [params.id]);
    if (!connection) {
      HttpServer.json(res, 404, { error: 'Connection not found', code: 'NOT_FOUND' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const { priority, weight, minAmountPaise, maxAmountPaise, isPrimary, strategy } = body;

    const ruleId = crypto.randomUUID();
    const now = new Date().toISOString();

    ctx.db.execute(
      `INSERT INTO routing_rules (id, merchant_id, receiving_account_id, priority, weight, min_amount_paise,
       max_amount_paise, is_enabled, is_primary, strategy, health_check_interval_sec, failure_threshold,
       recovery_probe_interval_sec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ruleId, connection.merchant_id, connection.approved_account_id, priority || 100, weight || 100,
       minAmountPaise || null, maxAmountPaise || null, 1, isPrimary ? 1 : 0,
       strategy || 'PRIORITY_BASED', 60, 3, 300, now, now]
    );

    logAudit(session.admin.id, 'ROUTING_RULE_ADDED', 'ROUTING_RULE', ruleId, {
      receivingAccountId: params.id, priority, weight, isPrimary
    }, req);

    HttpServer.json(res, 201, { success: true, ruleId });
  });

  // ============ SMART UPI ROUTING ============

  // GET /api/v1/super-admin/routing - Get all routing rules
  server.get(`${SUPER_ADMIN_PREFIX}/routing`, async (req, res) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session) {
      HttpServer.json(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const { merchantId } = req.query;
    const sql = merchantId
      ? 'SELECT * FROM routing_rules WHERE merchant_id = ? ORDER BY priority ASC'
      : 'SELECT * FROM routing_rules ORDER BY priority ASC';

    const rules = ctx.db.query(sql, merchantId ? [merchantId] : []);

    HttpServer.json(res, 200, {
      routes: (rules || []).map(r => ({
        id: r.id,
        merchantId: r.merchant_id,
        receivingAccountId: r.receiving_account_id,
        priority: r.priority,
        weight: r.weight,
        minAmountPaise: r.min_amount_paise,
        maxAmountPaise: r.max_amount_paise,
        isEnabled: Boolean(r.is_enabled),
        isPrimary: Boolean(r.is_primary),
        strategy: r.strategy,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    });
  });

  // GET /api/v1/super-admin/routing/health - Get route health status
  server.get(`${SUPER_ADMIN_PREFIX}/routing/health`, async (req, res) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session) {
      HttpServer.json(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const health = ctx.db.query(
      `SELECT rh.*, rr.merchant_id, rr.receiving_account_id, rr.priority, rr.is_primary
       FROM route_health rh
       JOIN routing_rules rr ON rh.routing_rule_id = rr.id
       ORDER BY rh.updated_at DESC`
    );

    HttpServer.json(res, 200, {
      routes: (health || []).map(h => ({
        id: h.id,
        routingRuleId: h.routing_rule_id,
        merchantId: h.merchant_id,
        receivingAccountId: h.receiving_account_id,
        priority: h.priority,
        isPrimary: Boolean(h.is_primary),
        status: h.status,
        successRate: h.success_rate,
        timeoutRate: h.timeout_rate,
        errorRate: h.error_rate,
        avgLatencyMs: h.avg_latency_ms,
        circuitBreakerState: h.circuit_breaker_state,
        consecutiveFailures: h.consecutive_failures,
        lastSuccessAt: h.last_success_at,
        lastFailureAt: h.last_failure_at,
        lastHealthCheckAt: h.last_health_check_at
      }))
    });
  });

  // POST /api/v1/super-admin/routing/:id/health - Update route health (internal/probe)
  server.post(`${SUPER_ADMIN_PREFIX}/routing/:id/health`, async (req, res, params) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const { status, successRate, timeoutRate, errorRate, avgLatencyMs, circuitBreakerState } = body;

    const health = ctx.db.queryOne('SELECT * FROM route_health WHERE routing_rule_id = ?', [params.id]);
    if (!health) {
      HttpServer.json(res, 404, { error: 'Route health not found', code: 'NOT_FOUND' });
      return;
    }

    const now = new Date().toISOString();
    ctx.db.execute(
      `UPDATE route_health SET status = $1, success_rate = $2, timeout_rate = $3, error_rate = $4,
       avg_latency_ms = $5, circuit_breaker_state = $6, updated_at = $7
       WHERE routing_rule_id = $8`,
      [status || 'HEALTHY', successRate || 1, timeoutRate || 0, errorRate || 0,
       avgLatencyMs || 0, circuitBreakerState || 'CLOSED', now, params.id]
    );

    HttpServer.json(res, 200, { success: true, message: 'Route health updated' });
  });

  // GET /api/v1/super-admin/failover - Get failover events
  server.get(`${SUPER_ADMIN_PREFIX}/failover`, async (req, res) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session) {
      HttpServer.json(res, 401, { error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    const events = ctx.db.query('SELECT * FROM failover_events ORDER BY created_at DESC LIMIT 100');

    HttpServer.json(res, 200, {
      events: (events || []).map(e => ({
        id: e.id,
        paymentOrderId: e.payment_order_id,
        fromRouteId: e.from_route_id,
        toRouteId: e.to_route_id,
        reason: e.reason,
        trigger: e.trigger,
        status: e.status,
        createdAt: e.created_at
      }))
    });
  });

  // POST /api/v1/super-admin/routing/select - Test route selection
  server.post(`${SUPER_ADMIN_PREFIX}/routing/select`, async (req, res) => {
    const session = superAdminRepo.findSessionByToken(req.headers['authorization']?.replace('Bearer ', '') || '');
    if (!session || session.admin.role !== 'SUPER_ADMIN') {
      HttpServer.json(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const { merchantId, amountPaise } = body;

    if (!merchantId || amountPaise === undefined) {
      HttpServer.json(res, 400, { error: 'merchantId and amountPaise are required', code: 'MISSING_FIELDS' });
      return;
    }

    const selection = ctx.routingEngine.selectRoute(merchantId, Number(amountPaise));

    if (!selection) {
      HttpServer.json(res, 404, { error: 'No eligible route available', code: 'NO_ROUTE_AVAILABLE' });
      return;
    }

    HttpServer.json(res, 200, {
      success: true,
      selected: {
        routeId: selection.route.id,
        receivingAccountId: selection.route.receivingAccountId,
        priority: selection.route.priority,
        weight: selection.route.weight,
        strategy: selection.route.strategy,
        isPrimary: selection.route.isPrimary,
        minAmountPaise: selection.route.minAmountPaise,
        maxAmountPaise: selection.route.maxAmountPaise
      },
      receivingAccount: selection.receivingAccount ? {
        id: selection.receivingAccount.id,
        upiId: selection.receivingAccount.upiId,
        payeeName: selection.receivingAccount.payeeName,
        isActive: selection.receivingAccount.isActive
      } : null,
      health: selection.health ? {
        status: selection.health.status,
        successRate: selection.health.successRate,
        circuitBreakerState: selection.health.circuitBreakerState,
        consecutiveFailures: selection.health.consecutiveFailures,
        avgLatencyMs: selection.health.avgLatencyMs
      } : null,
      selectionReason: selection.selectionReason
    });
  });
}

/**
 * Super Admin Authentication Guard
 * Protects routes that require Super Admin authentication.
 * Checks for a valid Bearer token in the Authorization header.
 */
export function superAdminGuard(req, res, pathname, url) {
  // Public paths that don't require auth
  const PUBLIC_PATHS = [
    '/api/v1/super-admin/login',
    '/api/v1/super-admin/mfa/enroll',
    '/api/v1/super-admin/mfa/verify'
  ];

  if (!pathname.startsWith('/api/v1/super-admin/')) return false;

  if (PUBLIC_PATHS.includes(pathname)) return false;

  const presented = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(presented);
  const token = match ? match[1] : '';

  if (!token) {
    HttpServer.json(res, 401, { error: 'Super Admin authentication required', code: 'AUTH_REQUIRED' });
    return true;
  }

  const { superAdminRepo } = global.__sanbook_ctx || {};
  if (!superAdminRepo) {
    HttpServer.json(res, 500, { error: 'Auth system not initialized', code: 'SYSTEM_ERROR' });
    return true;
  }

  const session = superAdminRepo.findSessionByToken(token);
  if (!session) {
    HttpServer.json(res, 401, { error: 'Invalid or expired session', code: 'INVALID_SESSION' });
    return true;
  }

  // Check expiry
  if (new Date(session.expiresAt) <= new Date()) {
    superAdminRepo.revokeSession(token);
    HttpServer.json(res, 401, { error: 'Session expired', code: 'SESSION_EXPIRED' });
    return true;
  }

  // Attach admin info to request for route handlers
  req.superAdmin = session.admin;
  req.superAdminSession = session;

  return false;
}

/**
 * Super Admin Role Guard
 * Requires specific role for access.
 */
export function superAdminRoleGuard(allowedRoles) {
  return (req, res, pathname, url) => {
    if (!req.superAdmin) return false;
    if (!allowedRoles.includes(req.superAdmin.role)) {
      HttpServer.json(res, 403, { error: 'Insufficient role', code: 'INSUFFICIENT_ROLE' });
      return true;
    }
    return false;
  };
}
