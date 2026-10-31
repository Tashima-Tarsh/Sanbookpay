import {registerPaymentControls} from './payment-controls.js';
import {registerPlatformIdentity} from './platform/identity.js';
import {registerPlatformPayments} from './platform/payments.js';
import {registerPlatformOperations} from './platform/operations.js';
import fs from 'node:fs';
import { registerMerchantConsoleRoutes } from './routes/merchant-console.routes.js';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PaymentStatus, safeEqual } from '@youpi/common';
import { DynamoPayQueue } from '@youpi/common';
import { DynamoPayWebhooks } from '@youpi/common';
import { DynamoPayGmailVerification } from '@youpi/common';
import { DynamoPaySMSGateway } from '@youpi/common';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

// In production, reliably ensure environment variables from .env are loaded if not already provided
if (!process.env.BASE_CHECKOUT_URL && typeof process.loadEnvFile === 'function') {
  try {
    const rootEnv = path.resolve(rootDir, '.env');
    if (fs.existsSync(rootEnv)) {
      process.loadEnvFile(rootEnv);
    }
  } catch {}
}

// Validate production environment before starting services
import { default as validateEnv } from '../../../scripts/validate-env.js';
validateEnv();
import {
  getDatabase,
  ensureDatabaseInitialized,
  runMigrations,
  MerchantRepository,
  ReceivingAccountRepository,
  CustomerRepository,
  CustomerSessionRepository,
  PaymentSessionRepository,
  ObservationRepository,
  SupportTicketRepository,
  AuditLogRepository,
  DeviceRepository,
  SuperAdminRepository,
  MerchantUserRepository,
  RoleRepository,
  MfaRepository,
  SmartRoutingEngine,
  RoutingRepository,
  WalletRepository,
  PricingRepository,
  DiagnosticRepository,
  MerchantUpiConnectionRepository,
  MerchantObserverDeviceRepository,
  DevicePairingChallengeRepository,
  ObserverSourceConfigRepository,
  SubscriptionEntitlementRepository,
  ConnectionHealthEventRepository,
  AdminAuditEventRepository,
  CallbackOutboxRepository,
  CallbackDeliveryAttemptRepository,
  UpiMirrorObservationRepository
} from '@youpi/db';
import {
  QueueEngine,
  TimingEngine,
  AttributionEngine,
  RecoveryEngine,
  WebhookEngine,
  PaymentVerificationPipeline,
  FlashMatchingEngine,
  UpiMirrorService
} from '@youpi/core';
import { HttpServer } from './server.js';
import { authGuard, isAdminRequest } from './auth-guard.js';
import { registerPaymentRoutes } from './routes/payments.routes.js';
import { registerCheckoutRoutes } from './routes/checkout.routes.js';
import { registerPollerRoutes } from './routes/pollers.routes.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import { registerCustomerRoutes } from './routes/customer.routes.js';
import { registerDeviceRoutes } from './routes/device.routes.js';
import { registerCollectionsRoutes } from './routes/collections.routes.js';
import { registerPayoutsRoutes } from './routes/payouts.routes.js';
import { registerBankingRoutes } from './routes/banking.routes.js';
import { registerProviderWebhooksRoutes } from './routes/provider-webhooks.routes.js';
import { registerSettlementsRoutes } from './routes/settlements.routes.js';
import { registerRefundsRoutes } from './routes/refunds.routes.js';
import { registerSplitSettlementRoutes } from './routes/split-settlement.routes.js';
import { registerOperationsRoutes } from './routes/operations.routes.js';
import { registerDynamoPayRoutes } from './routes/dynamopay.routes.js';
import { registerSuperAdminRoutes } from './routes/super-admin.routes.js';
import { registerSuperAdminUpiMirrorRoutes } from './routes/super-admin-upi-mirror.routes.js';
import { registerUpiMirrorRoutes } from './routes/upi-mirror.routes.js';
import { registerPaymentLinkRoutes } from './routes/payment-link.routes.js';
import { registerCallbackWalletRoutes } from './routes/callback-wallet.routes.js';
import { getWhatsAppBerryService, WhatsAppBerryService } from './services/whatsapp-berry.service.js';
import { ReceiptNotificationService } from './services/receipt-notification.service.js';

export function createPaymentApp(customDb = null, options = {}) {
  const db = customDb || getDatabase();
  ensureDatabaseInitialized(db);
  const { defaultMerchant } = runMigrations(db);
  const isCustom = !!customDb;
  const whatsappBerryService = options.whatsappBerryService || (isCustom ? new WhatsAppBerryService({
    sessionId: 'test_berry_session',
    sessionPath: path.resolve(rootDir, 'data/test_berry_auth'),
    databasePath: path.resolve(rootDir, 'data/test_berry_store.db'),
    metaFile: path.resolve(rootDir, 'data/test_whatsapp_session.json'),
    simulated: process.env.NODE_ENV === 'test'
  }) : getWhatsAppBerryService());

  const merchantRepo = new MerchantRepository(db);
  const accountRepo = new ReceivingAccountRepository(db);
  const customerRepo = new CustomerRepository(db);
  const customerSessionRepo = new CustomerSessionRepository(db, customerRepo);
  const sessionRepo = new PaymentSessionRepository(db);
  const obsRepo = new ObservationRepository(db);
  const upiConnectionRepository = new MerchantUpiConnectionRepository(db);
  const observerDeviceRepository = new MerchantObserverDeviceRepository(db);
  const pairingChallengeRepository = new DevicePairingChallengeRepository(db);
  const observerSourceConfigRepository = new ObserverSourceConfigRepository(db);
  const subscriptionEntitlementRepository = new SubscriptionEntitlementRepository(db);
  const connectionHealthEventRepository = new ConnectionHealthEventRepository(db);
  const adminAuditEventRepository = new AdminAuditEventRepository(db);
  const callbackOutboxRepository = new CallbackOutboxRepository(db);
  const callbackDeliveryAttemptRepository = new CallbackDeliveryAttemptRepository(db);
  const upiMirrorObservationRepository = new UpiMirrorObservationRepository(db);
  const ticketRepo = new SupportTicketRepository(db);
  const auditRepo = new AuditLogRepository(db);
  const deviceRepo = new DeviceRepository(db);
  const receiptService = new ReceiptNotificationService(db, auditRepo);

  // Super Admin repositories
  const superAdminRepo = new SuperAdminRepository(db);
  const merchantUserRepo = new MerchantUserRepository(db);
  const roleRepo = new RoleRepository(db);
  const mfaRepo = new MfaRepository(db);
  const walletRepo = new WalletRepository(db);
  const pricingRepo = new PricingRepository(db);
  const diagnosticRepo = new DiagnosticRepository(db);

  const eventEmitter = new EventEmitter();

  const queueEngine = new QueueEngine({
    sessionRepo,
    accountRepo,
    eventEmitter,
    auditRepo
  });

  const timingEngine = new TimingEngine({
    sessionRepo,
    queueEngine,
    eventEmitter,
    auditRepo,
    activeDurationMs: Number(process.env.PAYMENT_ACTIVE_WINDOW_MS || 300000),
    processingDurationMs: Number(process.env.PAYMENT_PROCESSING_WINDOW_MS || 30000)
  });

  const attributionEngine = new AttributionEngine({
    sessionRepo,
    obsRepo,
    ticketRepo,
    auditRepo,
    eventEmitter
  });

  const recoveryEngine = new RecoveryEngine({
    db,
    sessionRepo,
    accountRepo,
    queueEngine,
    timingEngine,
    auditRepo
  });

  const providerWebhookEngine = new WebhookEngine({db,merchantRepo,deliveryTable:'provider_webhook_deliveries'});
  const webhookEngine = new WebhookEngine({
    db,
    merchantRepo,
    maxRetries: Number(process.env.WEBHOOK_MAX_RETRIES || 5)
  });

  // UPI Mirror services (Phases 3-4)
  const flashMatchingEngine = new FlashMatchingEngine({
    db,
    sessionRepo,
    obsRepo,
    upiMirrorObsRepo: upiMirrorObservationRepository,
    upiConnectionRepo: upiConnectionRepository,
    callbackOutboxRepo: callbackOutboxRepository,
    eventEmitter
  });

  const upiMirrorService = new UpiMirrorService({
    db,
    upiConnectionRepo: upiConnectionRepository,
    observerDeviceRepo: observerDeviceRepository,
    pairingChallengeRepo: pairingChallengeRepository,
    observerSourceConfigRepo: observerSourceConfigRepository,
    subscriptionEntitlementRepo: subscriptionEntitlementRepository,
    connectionHealthEventRepo: connectionHealthEventRepository,
    upiMirrorObservationRepo: upiMirrorObservationRepository,
    callbackOutboxRepo: callbackOutboxRepository,
    callbackDeliveryAttemptRepo: callbackDeliveryAttemptRepository,
    sessionRepo,
    merchantRepo,
    auditRepo,
    flashMatchingEngine,
    eventEmitter
  });

  // Dynamo Pay production services
  const dynamoQueue = new DynamoPayQueue();
  const dynamoWebhooks = new DynamoPayWebhooks();
  const dynamoGmail = new DynamoPayGmailVerification();
  const dynamoSMS = new DynamoPaySMSGateway();

  // Connect Dynamo Pay queue to Redis
  dynamoQueue.connect().catch((err) => {
    console.warn('[DynamoPay Queue] Redis connection failed:', err.message);
    console.warn('[DynamoPay Queue] Running without Redis queue - using in-memory fallback');
  });

  // Connect Gmail verification if credentials available
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    console.log('[DynamoPay Gmail] OAuth2 credentials configured');
  } else {
    console.warn('[DynamoPay Gmail] No credentials - SMS/Gmail verification disabled');
  }

  // Connect SMS Gateway if URL available
  if (process.env.SMS_GATEWAY_URL) {
    console.log('[DynamoPay SMS] Gateway configured:', process.env.SMS_GATEWAY_URL);
  } else {
    console.warn('[DynamoPay SMS] No gateway URL - SMS verification disabled');
  }

  const server = new HttpServer();
  flashMatchingEngine.server = server;
  upiMirrorService.server = server;
  server.use(authGuard);
  let checkoutBaseUrl = process.env.BASE_CHECKOUT_URL || 'http://localhost:7000';
  try {
    const rootEnv = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(rootEnv)) {
      const raw = fs.readFileSync(rootEnv, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('BASE_CHECKOUT_URL=')) {
          const val = trimmed.split('=')[1]?.trim();
          if (val) checkoutBaseUrl = val.replace(/^["']|["']$/g, '');
        }
      }
    }
  } catch {}

  // BULLETPROOF QUEUE PROMOTION HANDLER
  function handleSlotFreedAndPromote(receivingAccountId) {
    if (!receivingAccountId) return null;
    const promoted = queueEngine.promoteNext(receivingAccountId);
    if (promoted) {
      if (promoted.expiresAt) {
        timingEngine.startActiveTimer(promoted.id, promoted.expiresAt);
      }
      server.broadcastSse(promoted.id, 'status_change', {
        status: PaymentStatus.ACTIVE,
        queuePosition: 0,
        expiresAt: promoted.expiresAt
      });
      server.broadcastSse(`queue_${receivingAccountId}`, 'queue_update', {
        promotedId: promoted.id
      });
    }
    return promoted;
  }

  for(const name of ['SESSION.ACTIVATED','SESSION.QUEUED','SESSION.PROCESSING','PAYMENT.SUCCESS','PAYMENT.FAILED','PAYMENT.EXPIRED','PAYMENT.CANCELLED','PAYMENT.VERIFICATION_PENDING','PAYMENT.VERIFICATION_UPGRADED']) {
    eventEmitter.on(name,data=>{
      const id=data.paymentId||data.sessionId;
      if(!id)return;
      const session=sessionRepo.findById(id);
      if(session) server.broadcastSse(`console_${session.merchantId}`,'activity',{paymentId:session.id,status:session.status});
    });
  }

  // When a payment succeeds, fails, expires, or cancels: dispatch webhook & promote next queued customer
  eventEmitter.on('PAYMENT.SUCCESS', (data) => {
    const session = sessionRepo.findById(data.paymentId);
    if (session) {
      server.broadcastSse(session.id, 'status_change', {
        status: PaymentStatus.SUCCESS,
        verificationLevel: data.verificationLevel || session.verificationLevel || 1,
        verificationTag: data.verificationTag || session.verificationTag,
        sources: data.sources || session.verificationSources
      });
      if(!data.webhookQueued)webhookEngine.dispatch('SUCCESS', session).catch(() => {});
      try {
        const customer = session.customerId ? customerRepo.findById(session.customerId) : null;
        const merchant = (session.merchantId ? merchantRepo.findById(session.merchantId) : null) || defaultMerchant;
        receiptService.sendPaymentReceipt(session, customer, merchant).catch(error=>console.error('[Receipt generation]',error.message));
      } catch (err) {
        console.error('[ReceiptNotification] Failed to dispatch receipt:', err.message);
      }
      handleSlotFreedAndPromote(session.receivingAccountId);
    }
  });

  eventEmitter.on('PAYMENT.LEVEL1_VERIFIED', (data) => {
    server.broadcastSse(data.paymentId, 'status_change', {
      status: 'VERIFYING',
      verificationLevel: 1,
      verificationTag: data.verificationTag,
      message: 'Payment detected! Verifying secondary channel...'
    });
  });

  eventEmitter.on('PAYMENT.FAILED', (data) => {
    const session = sessionRepo.findById(data.paymentId);
    if (session) {
      webhookEngine.dispatch('FAILED', session).catch(() => {});
      handleSlotFreedAndPromote(session.receivingAccountId);
    }
  });
  eventEmitter.on('PAYMENT.VERIFICATION_PENDING', data => {
    server.broadcastSse(data.paymentId, 'status_change', { status: PaymentStatus.VERIFICATION_PENDING });
    try{attributionEngine.reconcilePendingPayment(data.paymentId);}catch(error){console.error('[Pending bank reconciliation]',error.message);}
  });

  eventEmitter.on('PAYMENT.EXPIRED', (data) => {
    const session = sessionRepo.findById(data.paymentId);
    if (session) {
      server.broadcastSse(session.id, 'status_change', {
        status: PaymentStatus.EXPIRED
      });
      webhookEngine.dispatch('EXPIRED', session).catch(() => {});
      handleSlotFreedAndPromote(session.receivingAccountId);
    }
  });

  eventEmitter.on('PAYMENT.CANCELLED', (data) => {
    const session = sessionRepo.findById(data.paymentId);
    if (session) {
      server.broadcastSse(session.id, 'status_change', {
        status: PaymentStatus.CANCELLED
      });
      webhookEngine.dispatch('CANCELLED', session).catch(() => {});
      handleSlotFreedAndPromote(session.receivingAccountId);
    }
  });

  eventEmitter.on('PAYMENT.FRAUD_BLOCKED', (data) => {
    if (data.sessionId) {
      server.broadcastSse(data.sessionId, 'status_change', {
        status: 'BLOCKED',
        isBanned: true,
        fraudDetected: true,
        orderId: data.orderId,
        reason: data.reason || 'FRAUDULENT_PAYMENT_INJECTION',
        blockedNotice: {
          title: 'FRAUDULENT ACTIVITY DETECTED',
          subtitle: 'Payment Session Terminated & Account Suspended',
          message: 'Our automated verification engine detected fraudulent payment activity associated with this account. Access has been immediately suspended while our security operations team investigates the issue.',
          investigating: true
        }
      });
      server.broadcastSse(data.sessionId, 'account_blocked', {
        status: 'BLOCKED',
        isBanned: true,
        fraudDetected: true,
        orderId: data.orderId,
        reason: data.reason || 'FRAUDULENT_PAYMENT_INJECTION'
      });
    }
  });

  // Active 30-Second Verification Polling Orchestrator (Triple Verification Standard):
  // Concurrently sweeps Gmail, Google Messages SMS, and Android Observer every 1.5s
  // Continues polling for remaining sources until Level 3 (Triple Verification) is reached or 30s window finishes!
  const activeSweepTimers = new Set();

  eventEmitter.on('SESSION.PROCESSING', (data) => {
    const sessionId = data.sessionId;
    let sweepCount = 0;
    const maxSweeps = 20; // 20 sweeps * 1.5s = 30 seconds

    const sweepTimer = setInterval(async () => {
      try {
        sweepCount++;
        const current = sessionRepo.findById(sessionId);

        // Stop polling if session is terminal failed/expired/cancelled, or reached full Triple Verification (level >= 3), or exceeded 30s
        const isCompleteOrCancelled = !current ||
          current.status === PaymentStatus.FAILED ||
          current.status === PaymentStatus.EXPIRED ||
          current.status === PaymentStatus.CANCELLED ||
          (current.verificationLevel >= 3) ||
          sweepCount >= maxSweeps;

        if (isCompleteOrCancelled) {
          clearInterval(sweepTimer);
          activeSweepTimers.delete(sweepTimer);
          return;
        }

        // Sweep 1: Google Messages Web SMS
        try {
          const smsPort = Number(process.env.SMS_OBSERVER_PORT || 6002);
          fetch(`http://localhost:${smsPort}/api/sweep`, { method: 'POST', signal: AbortSignal.timeout(1200) }).catch(() => {});
        } catch {}

        // Sweep 2: Gmail Inbox
        try {
          const gmailPort = Number(process.env.GMAIL_OBSERVER_PORT || 6003);
          fetch(`http://localhost:${gmailPort}/api/sweep`, { method: 'POST', signal: AbortSignal.timeout(1200) }).catch(() => {});
        } catch {}

        // Sweep 3: Check pending/unattributed Android push notifications in DB
        try {
          const unattributed = obsRepo.findUnattributed(current.receivingAccountId);
          for (const obs of unattributed) {
            attributionEngine.processObservation({
              source: obs.source,
              receivingAccountId: obs.receivingAccountId,
              amountPaise: obs.amountPaise,
              observedAt: obs.observedAt,
              bankReferenceNumber: obs.bankReferenceNumber,
              senderVpa: obs.senderVpa,
              rawPayload: obs.rawPayload,
              fingerprintHash: obs.fingerprintHash
            });
          }
        } catch {}
      } catch {
        clearInterval(sweepTimer);
        activeSweepTimers.delete(sweepTimer);
      }
    }, 1500);

    if (sweepTimer.unref) sweepTimer.unref();
    activeSweepTimers.add(sweepTimer);
  });

  // Continuous 1-second background queue sync and auto-expiry daemon
  const queueSyncDaemon = setInterval(() => {
    try {
      const nowIso = new Date().toISOString();

      // Sweep expired ACTIVE sessions
      const expiredActive = db.query(`
        SELECT id, receiving_account_id FROM payment_sessions
        WHERE status = 'ACTIVE' AND expires_at <= ?
      `, [nowIso]);

      for (const row of expiredActive) {
        sessionRepo.transitionToTerminal(row.id, PaymentStatus.EXPIRED);
        server.broadcastSse(row.id, 'status_change', { status: PaymentStatus.EXPIRED });
        handleSlotFreedAndPromote(row.receiving_account_id);
      }

      // Sweep failed PROCESSING sessions
      const failedProc = db.query(`
        SELECT id, receiving_account_id FROM payment_sessions
        WHERE status = 'PROCESSING' AND processing_expires_at <= ?
      `, [nowIso]);

      for (const row of failedProc) {
        timingEngine.handleProcessingTimerExpiration(row.id);
        handleSlotFreedAndPromote(row.receiving_account_id);
      }

      const pendingBankMatches=db.query(`SELECT DISTINCT ps.id FROM payment_sessions ps JOIN payment_observations obs ON obs.receiving_account_id=ps.receiving_account_id AND obs.amount_paise=ps.amount_paise AND obs.bank_reference_number=json_extract(ps.metadata,'$.reportedUtr') WHERE ps.status='VERIFICATION_PENDING' AND obs.attributed_payment_id IS NULL AND obs.attribution_status IN ('UNATTRIBUTED','LATE_UNMATCHED') AND obs.source IN ('GMAIL','GOOGLE_MESSAGES','ANDROID_OBSERVER','SMS_GATEWAY')`);
      for(const row of pendingBankMatches)attributionEngine.reconcilePendingPayment(row.id);

      // Scan for vacant receiving accounts that have waiting queued sessions
      const vacantAccounts = db.query(`
        SELECT id FROM payment_receiving_accounts
        WHERE is_active = 1 AND (is_slot_busy = 0 OR current_active_session_id IS NULL)
      `);

      for (const acc of vacantAccounts) {
        handleSlotFreedAndPromote(acc.id);
      }
    } catch {}
  }, 1000);

  if (queueSyncDaemon.unref) queueSyncDaemon.unref();

  // Continuous 1-Second Aggressive Polling Daemon across SMS Gateway & Gmail Observers
  const aggressivePollerDaemon = setInterval(async () => {
    try {
      // Find all active/processing sessions currently waiting for bank confirmation
      const activeSessions = db.query(`
        SELECT id, receiving_account_id, amount_paise, status
        FROM payment_sessions
        WHERE status IN ('ACTIVE', 'PROCESSING') AND method = 'UPI'
      `);

      if (activeSessions.length === 0) return;

      // 1. Poll SMS Observer
      try {
        const smsPort = Number(process.env.SMS_OBSERVER_PORT || 6002);
        fetch(`http://localhost:${smsPort}/api/sweep`, { method: 'POST', signal: AbortSignal.timeout(800) }).catch(() => {});
      } catch {}

      // 2. Poll Gmail Observer
      try {
        const gmailPort = Number(process.env.GMAIL_OBSERVER_PORT || 6003);
        fetch(`http://localhost:${gmailPort}/api/sweep`, { method: 'POST', signal: AbortSignal.timeout(800) }).catch(() => {});
      } catch {}

      // 3. Sweep any pending unattributed observations in DB matching active sessions
      for (const session of activeSessions) {
        try {
          const unattributed = obsRepo.findUnattributed(session.receiving_account_id);
          for (const obs of unattributed) {
            attributionEngine.processObservation({
              source: obs.source,
              receivingAccountId: obs.receivingAccountId,
              amountPaise: obs.amountPaise,
              observedAt: obs.observedAt,
              bankReferenceNumber: obs.bankReferenceNumber,
              senderVpa: obs.senderVpa,
              rawPayload: obs.rawPayload,
              fingerprintHash: obs.fingerprintHash
            });
          }
        } catch {}
      }
    } catch {}
  }, 1000);

  if (aggressivePollerDaemon.unref) aggressivePollerDaemon.unref();

  // Execute crash recovery on boot
  const recoveryStats = recoveryEngine.recover();

  // Health check routes
  const healthHandler = (req, res) => {
    HttpServer.json(res, 200, {
      status: 'UP',
      service: 'payment-api',
      timestamp: new Date().toISOString(),
      recoveryStats
    });
  };
  server.get('/health', healthHandler);
  server.get('/api/v1/health', healthHandler);

  const pipeline = new PaymentVerificationPipeline({
    db,
    sessionRepo,
    obsRepo,
    customerRepo,
    attributionEngine,
    auditRepo,
    merchantRepo,
    server,
    eventEmitter
  });

  const context = {
    db,
    merchantRepo,
    accountRepo,
    customerRepo,
    customerSessionRepo,
    sessionRepo,
    deviceRepo,
    obsRepo,
    ticketRepo,
    auditRepo,
    queueEngine,
    timingEngine,
    attributionEngine,
    pipeline,
    recoveryEngine,
    eventEmitter,
    defaultMerchant,
    checkoutBaseUrl,
    whatsappBerryService,
    receiptService,
    webhookEngine,
    providerWebhookEngine,
    dynamoQueue,
    dynamoWebhooks,
    dynamoGmail,
    dynamoSMS,
    superAdminRepo,
    merchantUserRepo,
    roleRepo,
    mfaRepo,
    routingRepo: new RoutingRepository(db),
    walletRepo,
    pricingRepo,
    diagnosticRepo,
    upiConnectionRepo: upiConnectionRepository,
    observerDeviceRepo: observerDeviceRepository,
    pairingChallengeRepo: pairingChallengeRepository,
    observerSourceConfigRepo: observerSourceConfigRepository,
    subscriptionEntitlementRepo: subscriptionEntitlementRepository,
    connectionHealthEventRepo: connectionHealthEventRepository,
    adminAuditEventRepo: adminAuditEventRepository,
    callbackOutboxRepo: callbackOutboxRepository,
    callbackDeliveryAttemptRepo: callbackDeliveryAttemptRepository,
    upiMirrorObservationRepo: upiMirrorObservationRepository
  };

  // Smart Routing Engine (created after context is available)
  context.routingEngine = new SmartRoutingEngine(context);

  const platformIdentity=registerPlatformIdentity(server,context);
  const platformPayments=registerPlatformPayments(server,context,platformIdentity);
  context.platformIdentity=platformIdentity;
  context.platformPayments=platformPayments;
  context.canActivateMerchant=id=>Boolean(db.queryOne("SELECT c.id FROM provider_connections c JOIN pp_connection_policy p ON p.connection_id=c.id WHERE c.merchant_id=? AND c.environment='PRODUCTION' AND p.approved=1 AND p.enabled=1 AND c.is_active=1",[id]));
  // Existing merchants retain their current operational state; registration never creates this grant.
  for(const legacy of merchantRepo.findAll())if(!db.queryOne('SELECT merchant_id FROM pp_merchants WHERE merchant_id=?',[legacy.id]))db.execute('INSERT INTO pp_merchants(merchant_id,status,profile,created_at,updated_at) VALUES(?,?,?,?,?)',[legacy.id,'ACTIVE',JSON.stringify({businessName:legacy.businessName,legacyInstallation:true}),legacy.createdAt?.toISOString?.()||new Date().toISOString(),new Date().toISOString()]);
  server.use(platformPayments.guard);
  server.use(platformIdentity.guard);
  registerPlatformOperations(server,context,platformIdentity);
  server.use((req,res,pathname)=>{
    if(req.method==='POST'&&pathname==='/api/v1/payments'&&!isAdminRequest(req)){
      const mid=req.headers['x-merchant-id'];
      if(!mid)return false;
      const m=mid&&merchantRepo.findById(mid);
      if(!m||!safeEqual(String(req.headers['x-merchant-key']||''),m.webhookSecret||'')){HttpServer.json(res,401,{error:'Authenticate the merchant backend before creating a payment.',code:'AUTH_REQUIRED'});return true;}
      try{platformPayments.requireActive(mid);}catch(e){HttpServer.json(res,e.statusCode||403,{error:e.message,code:e.code});return true;}
    }
    return false;
  });
  registerPaymentControls(server,context);
  registerPaymentRoutes(server, context);
  registerCheckoutRoutes(server, context);
  registerPollerRoutes(server, context);
  registerAdminRoutes(server, context);
  registerMerchantConsoleRoutes(server, { ...context, eventEmitter });
  registerCustomerRoutes(server, context);
  registerDeviceRoutes(server, context);
  registerCollectionsRoutes(server, context);
  registerPayoutsRoutes(server, context);
  registerBankingRoutes(server, context);
  registerProviderWebhooksRoutes(server, context);
  registerSettlementsRoutes(server, context);
  registerRefundsRoutes(server, context);
  registerSplitSettlementRoutes(server, context);
  registerOperationsRoutes(server, context);
  registerDynamoPayRoutes(server, context);

  // Super Admin authentication routes
  registerSuperAdminRoutes(server, context);

  // Super Admin UPI Mirror management routes (Phase 7)
  registerSuperAdminUpiMirrorRoutes(server, {
    ...context,
    upiConnectionRepo: upiConnectionRepository,
    observerDeviceRepo: observerDeviceRepository,
    pairingChallengeRepo: pairingChallengeRepository,
    observerSourceConfigRepo: observerSourceConfigRepository,
    subscriptionEntitlementRepo: subscriptionEntitlementRepository,
    connectionHealthEventRepo: connectionHealthEventRepository,
    adminAuditEventRepo: adminAuditEventRepository,
    callbackOutboxRepo: callbackOutboxRepository,
    callbackDeliveryAttemptRepo: callbackDeliveryAttemptRepository,
    upiMirrorObservationRepo: upiMirrorObservationRepository
  });

  // Payment Links & Failover routes
  registerPaymentLinkRoutes(server, context);

  // Callback, Wallet, Diagnostics, Pricing routes
  registerCallbackWalletRoutes(server, context);

  // UPI Mirror routes (Phase 1-3)
  registerUpiMirrorRoutes(server, {
    ...context,
    upiConnectionRepo: upiConnectionRepository,
    observerDeviceRepo: observerDeviceRepository,
    pairingChallengeRepo: pairingChallengeRepository,
    observerSourceConfigRepo: observerSourceConfigRepository,
    subscriptionEntitlementRepo: subscriptionEntitlementRepository,
    connectionHealthEventRepo: connectionHealthEventRepository,
    upiMirrorObservationRepo: upiMirrorObservationRepository,
    callbackOutboxRepo: callbackOutboxRepository,
    callbackDeliveryAttemptRepo: callbackDeliveryAttemptRepository,
    featureFlags: new Map(),
    upiMirrorService,
    flashMatchingEngine
  });



  function destroy() {
    clearInterval(webhookRetryTimer);
    webhookEngine.stop();providerWebhookEngine.stop();
    clearInterval(queueSyncDaemon);
    clearInterval(aggressivePollerDaemon);
    for (const timer of activeSweepTimers) {
      clearInterval(timer);
    }
    activeSweepTimers.clear();
    timingEngine.destroy();
    if (typeof attributionEngine.destroy === 'function') {
      attributionEngine.destroy();
    }
    // Dynamo Pay services shutdown
    dynamoQueue.disconnect().catch(() => {});
    dynamoSMS.stopPolling();
    dynamoGmail.stopPolling();
  }

  let webhookRetryRunning=false;
  const webhookRetryTimer=setInterval(async()=>{
    if(webhookRetryRunning)return;webhookRetryRunning=true;
    try{await webhookEngine.retryPending();await providerWebhookEngine.retryPending();}catch(error){console.error('[Webhook retry]',error.message);}finally{webhookRetryRunning=false;}
  },5000);
  webhookRetryTimer.unref?.();

  return {
    server,
    context,
    destroy,
    rawServer: server.createServer()
  };
}

export function startServer(port = null, customDb = null) {
  const finalPort = port || Number(process.env.PAYMENT_API_PORT || 6100);

  // Fail fast in production rather than silently running with dev defaults.
  if (process.env.NODE_ENV === 'production') {
    const required = ['ENCRYPTION_MASTER_KEY', 'JWT_SECRET'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length) {
      console.error(`[Payment API] Missing required environment variables in production: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  const app = createPaymentApp(customDb);

  return new Promise(resolve => {
    // Loopback by default; reach this service via the local Cloudflare Tunnel, not 0.0.0.0.
    const bindHost = process.env.YOUPI_BIND_HOST || '127.0.0.1';
    const instance = app.rawServer.listen(finalPort, bindHost, () => {
      console.log(`[Payment API] Server listening on port ${finalPort}`);
      resolve({
        app,
        port: finalPort,
        close: () => new Promise(cb => {
          app.destroy();
          instance.closeAllConnections?.();
          instance.close(cb);
        })
      });
    });
  });
}

// Auto-run if executed directly as main script
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
