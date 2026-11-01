import {isCurrentAndroidRelease} from '@youpi/common';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpServer } from '../server.js';
import { ObservationNormalizer, BankSmsParser, BankEmailParser, generateQrSvg } from '@youpi/core';
import { toRupeesString, toPaise, verifyHmac, resolveRuntimeUrls, resolveSecret, safeEqual, hasBearer, getObserverToken } from '@youpi/common';
import { isAdminRequest } from '../auth-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Upper bound on a single bank notification body accepted by the verification pipeline. */
const MAX_OBSERVATION_TEXT_CHARS = 64 * 1024;

/**
 * Registers observation intake routes for SMS Gateway (Android Native Observer)
 * and Automated Observers (Gmail Direct API / Web Observers).
 * @param {HttpServer} server
 * @param {{
 *   attributionEngine: import('@youpi/core').AttributionEngine,
 *   db: import('@youpi/db').Database,
 *   auditRepo: import('@youpi/db').AuditLogRepository,
 *   sessionRepo?: import('@youpi/db').PaymentSessionRepository,
 *   accountRepo?: import('@youpi/db').ReceivingAccountRepository,
 *   merchantRepo?: import('@youpi/db').MerchantRepository
 * }} ctx
 */
export function registerPollerRoutes(server, ctx) {
  // No public fallback: env value, else a random secret persisted in data/.secrets/.
  const enrollmentSecret = resolveSecret('android_enrollment_secret', 'ANDROID_ENROLLMENT_SECRET');

  // GET /api/v1/pollers/active-window (Enables deep intelligent DOM scanning for active amounts and dual-layer verification)
  server.get('/api/v1/pollers/active-window', async (req, res) => {
    // Observer-only. This returns every in-flight session with its exact amount and VPA,
    // which is precisely the oracle needed to craft a matching synthetic bank observation.
    if (!isAdminRequest(req) && !hasBearer(req, getObserverToken())) {
      HttpServer.json(res, 401, { error: 'Unauthorized', code: 'AUTH_REQUIRED' });
      return;
    }
    const activeSessions = ctx.db.query(`
      SELECT id, order_id, receiving_account_id, amount_paise, status, verification_level, expires_at, processing_expires_at, completed_at
      FROM payment_sessions
      WHERE status IN ('ACTIVE', 'PROCESSING')
         OR (status = 'SUCCESS' AND verification_level < 2 AND completed_at >= datetime('now', '-60 seconds'))
      ORDER BY created_at DESC
    `);

    const sessions = activeSessions.map(s => ({
      id: s.id,
      orderId: s.order_id,
      receivingAccountId: s.receiving_account_id,
      amount: toRupeesString(s.amount_paise),
      amountPaise: Number(s.amount_paise),
      status: s.status,
      verificationLevel: s.verification_level || 0,
      expiresAt: s.expires_at,
      processingExpiresAt: s.processing_expires_at
    }));

    HttpServer.json(res, 200, {
      hasActivePayment: sessions.length > 0,
      sessions
    });
  });

  // POST /api/v1/pollers/events (Universal Observation Ingest for Gmail / SMS 2-Layer Observers)
  server.post('/api/v1/pollers/events', async (req, res) => {
    const body = await HttpServer.parseBody(req);

    if (!body.receivingAccountId || !body.source) {
      HttpServer.json(res, 400, { error: 'Missing required fields: receivingAccountId and source.' });
      return;
    }

    // Evaluate through Security & Fraud Verification Pipeline
    const rawText = body.rawText || body.text || body.message || body.sms || body.body || (typeof body.rawPayload === 'string' ? body.rawPayload : (body.rawPayload?.text || body.rawPayload?.body));
    const sender = body.sender || body.from || body.rawPayload?.sender || body.rawPayload?.from;

    // Bank notifications are small. Reject oversized bodies outright so no single observation
    // can be used to burn CPU or memory on the verification path.
    if (typeof rawText === 'string' && rawText.length > MAX_OBSERVATION_TEXT_CHARS) {
      HttpServer.json(res, 413, { error: `Observation body too large (max ${MAX_OBSERVATION_TEXT_CHARS} characters).` });
      return;
    }

    if(ctx.receivingMirror&&rawText&&['GMAIL','EMAIL'].includes(body.source)){
      try{
        const observedAt=body.observedAt?new Date(body.observedAt):new Date();
        const parsed=BankEmailParser.parse({subject:body.subject||body.rawPayload?.subject||'',body:rawText,date:observedAt,from:sender});
        if(parsed){
          const detection=ctx.receivingMirror.record({accountId:body.receivingAccountId,source:'GMAIL',rawText,observedAt,amountPaise:parsed.amountPaise,bankReference:parsed.bankReferenceNumber||null});
          const paired=ctx.db.queryOne('SELECT b.device_id FROM pp_receiver_devices b JOIN android_devices d ON d.id=b.device_id WHERE b.account_id=? AND d.is_active=1',[body.receivingAccountId]);
          if(paired)return HttpServer.json(res,200,{accepted:true,status:detection.matchStatus==='NOTIFICATION_CONFIRMED'?'SUCCESS':'VERIFICATION_PENDING',detection});
        }
      }catch(error){return HttpServer.json(res,error.statusCode||503,{error:'Email mirror could not persist this event; retry required'});}
    }

    if (ctx.pipeline && rawText) {
      const pipeResult = ctx.pipeline.process({
        source: body.source,
        rawText,
        receivedAt:body.observedAt||body.timestamp,
        sender,
        receivingAccountId: body.receivingAccountId,
        paymentSessionId: body.paymentSessionId,
        // Test flags relax verification: honour them only for the admin credential, never for observers.
        isTest: Boolean(body.isTest) && isAdminRequest(req),
        testModeActive: Boolean(body.testModeActive) && isAdminRequest(req)
      });

      if (pipeResult.status === 'REJECTED' && pipeResult.failingCondition === 'FRAUDULENT_PAYMENT_INJECTION') {
        HttpServer.json(res, 403, {
          accepted: false,
          status: 'REJECTED',
          reason: 'FRAUDULENT_PAYMENT_INJECTION',
          threatDetected: true,
          banned: true,
          error: 'FRAUDULENT_PAYMENT_INJECTION: Positive identification of fake payment message. Customer account banned and session terminated.'
        });
        return;
      }

      if(['REJECTED','SUSPICIOUS'].includes(pipeResult.status)) return HttpServer.json(res,200,{accepted:false,status:pipeResult.status,reason:pipeResult.failingCondition||'OBSERVATION_NOT_VERIFIED',pipeline:pipeResult});

      if(pipeResult.status==='UNRESOLVED'&&pipeResult.stages?.stage6?.details?.observationId)return HttpServer.json(res,200,{accepted:true,status:'VERIFICATION_PENDING',observationId:pipeResult.stages.stage6.details.observationId,attribution:{attributed:false,outcomeStatus:'VERIFICATION_PENDING'},pipeline:pipeResult});

      if (pipeResult.status === 'VERIFIED') {
        HttpServer.json(res, 200, {
          accepted: true,
          observationId: pipeResult.messageId || pipeResult.stages?.stage6?.details?.observationId,
          attribution: { ...pipeResult.stages?.stage6?.details, attributed:true, paymentSessionId:pipeResult.stages?.stage6?.details?.attributedSessionId, outcomeStatus:pipeResult.stages?.stage6?.outcomeStatus },
          pipeline: pipeResult
        });
        return;
      }
    }

    if(!rawText && process.env.NODE_ENV!=='test') return HttpServer.json(res,400,{accepted:false,error:'Raw bank evidence is required.'});
    try {
      let amountPaise = body.amountPaise ? BigInt(body.amountPaise) : undefined;
      let bankRef = body.bankReferenceNumber || body.utr;
      let senderVpa = body.senderVpa;
      const observedAt = body.observedAt ? new Date(body.observedAt) : new Date();

      if (rawText && (!amountPaise || !bankRef)) {
        const isEmail = body.source === 'GMAIL' || body.source === 'EMAIL';
        const parsed = isEmail
          ? BankEmailParser.parse({ subject: body.subject || body.rawPayload?.subject || '', body: rawText, date: observedAt, from: sender })
          : BankSmsParser.parse({ text: rawText, sender, timestamp: observedAt });
        if (parsed) {
          if (!amountPaise) amountPaise = parsed.amountPaise;
          if (!bankRef && parsed.bankReferenceNumber) bankRef = parsed.bankReferenceNumber;
          if (!senderVpa && parsed.senderVpa) senderVpa = parsed.senderVpa;
        }
      }

      const normalized = ObservationNormalizer.normalize({
        source: body.source==='SMS'?'SMS_GATEWAY':body.source==='EMAIL'?'GMAIL':body.source,
        receivingAccountId: body.receivingAccountId,
        rawPayload: body.rawPayload || body,
        amountPaise,
        amount: body.amount || (amountPaise ? (Number(amountPaise) / 100).toFixed(2) : undefined),
        observedAt,
        senderVpa,
        bankReferenceNumber: bankRef
      });

      const result = ctx.attributionEngine.processObservation(normalized);

      HttpServer.json(res, 200, {
        accepted: true,
        observationId: result.observationId,
        attribution: result
      });
    } catch (err) {
      console.error('[Poller Ingest Error]:', err.message);
      HttpServer.json(res, 400, { error: err.message });
    }
  });

  // --- ANDROID SMS GATEWAY PAIRING HANDLER ---
  const handleAndroidPair = async (req, res) => {
    const body = await HttpServer.parseBody(req);
    const token = body.enrollmentToken || body.token;
    const merchantId = body.merchantId || '00000000-0000-0000-0000-000000000001';
    const deviceName = body.deviceName || 'Android SMS Gateway';
    const deviceModel = body.deviceModel || 'Android Device';

    // Verify enrollment token against system secret or merchant token
    const scopedPairing=Boolean(token)&&!safeEqual(String(token),enrollmentSecret);
    if (!token || (scopedPairing&&!ctx.receivingMirror)) {
      HttpServer.json(res, 401, { error: 'Invalid or expired device pairing enrollment token.' });
      return;
    }

    if (body.expiresAt && Date.now() > Number(body.expiresAt)) {
      HttpServer.json(res, 400, { error: 'PAIRING QR EXPIRED' });
      return;
    }

    if (body.version && body.version !== 'v1') {
      HttpServer.json(res, 400, { error: 'INVALID YOUPI PAIRING QR' });
      return;
    }

    const deviceId = crypto.randomUUID();
    const signingKey = crypto.randomBytes(32).toString('hex');
    const nowIso = new Date().toISOString();

    try {
      ctx.db.transaction(()=>{
      const binding=scopedPairing?ctx.receivingMirror.consumePairing(String(token),merchantId):null;
      ctx.db.execute(`
        INSERT INTO android_devices (id, merchant_id, device_name, device_model, signing_key_hash, is_active, last_heartbeat_at, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `, [deviceId, merchantId, deviceName, deviceModel, signingKey, nowIso, nowIso]);
      if(binding)ctx.receivingMirror.bindDevice(deviceId,binding);
      });

      if (ctx.auditRepo) {
        ctx.auditRepo.log({
          merchantId,
          entityType: 'ANDROID_DEVICE',
          entityId: deviceId,
          action: 'SMS_GATEWAY_DEVICE_PAIRED',
          actorType: 'ADMIN',
          details: { deviceName, deviceModel }
        });
      }

      server.broadcastSse('platform:operations','invalidate',{changed:true});
      server.broadcastSse('platform:merchant:'+merchantId,'invalidate',{changed:true});
      HttpServer.json(res, 200, {
        paired: true,
        deviceId,
        signingKey,
        merchantId,
        message: 'Android SMS Gateway paired successfully.'
      });
    } catch (err) {
      HttpServer.json(res, err.statusCode||500, { error: err.statusCode?err.message:'Failed to register Android device' });
    }
  };

  server.post('/api/v1/pollers/android/pair', handleAndroidPair);
  server.post('/api/v1/observers/sms/pair', handleAndroidPair);

  // --- ANDROID SMS GATEWAY OBSERVATION INGESTION ---
  const handleAndroidSmsEvents = async (req, res) => {
    let rawBodyText;
    try{rawBodyText=await HttpServer.parseRawBody(req);}catch{return HttpServer.json(res,413,{error:'Observation body is too large or incomplete'});}
    if(rawBodyText.length>MAX_OBSERVATION_TEXT_CHARS)return HttpServer.json(res,413,{error:'Observation exceeds the notification size limit'});

    let body = {};
    try {
      body = JSON.parse(rawBodyText);
    } catch {
      HttpServer.json(res, 400, { error: 'Invalid JSON payload.' });
      return;
    }

    const deviceId = req.headers['x-device-id'] || body.deviceId;
    if (!deviceId) {
      HttpServer.json(res, 400, { error: 'Missing required X-Device-Id header or deviceId.' });
      return;
    }

    // Verify registered device
    const device = ctx.db.queryOne('SELECT * FROM android_devices WHERE id = ? AND is_active = 1', [deviceId]);
    if (!device) {
      HttpServer.json(res, 403, { error: 'Device not authorized or inactive.' });
      return;
    }

    // Verify HMAC Signature & Replay Drift Protection
    const timestampStr = req.headers['x-timestamp'];
    const signature = req.headers['x-signature'];

    // Signature is mandatory: omitting the headers must not skip verification.
    if (!device.signing_key_hash || !timestampStr || !signature) {
      HttpServer.json(res, 401, { error: 'Missing X-Timestamp / X-Signature headers.' });
      return;
    }

    {
      const ts = Number(timestampStr);
      const now = Date.now();
      if (isNaN(ts) || Math.abs(now - ts) > 60000) {
        HttpServer.json(res, 401, { error: 'Timestamp drift exceeded validity window (replay protection triggered).' });
        return;
      }

      const sigPayload = `${rawBodyText}:${timestampStr}`;
      const isValid = verifyHmac(sigPayload, device.signing_key_hash, signature);
      if (!isValid) {
        HttpServer.json(res, 401, { error: 'Invalid cryptographic HMAC signature.' });
        return;
      }
    }

    // Resolve Receiving Account for this merchant
    const receiverBinding=ctx.receivingMirror?.binding(deviceId);
    if(receiverBinding&&body.receivingAccountId&&body.receivingAccountId!==receiverBinding.account_id)return HttpServer.json(res,403,{error:'Device receiving account binding mismatch'});
    let receivingAccountId = receiverBinding?.account_id || body.receivingAccountId;
    if (!receivingAccountId) {
      const activeAccount = ctx.accountRepo
        ? ctx.accountRepo.findActiveForMerchant(device.merchant_id)
        : ctx.db.queryOne('SELECT id FROM payment_receiving_accounts WHERE merchant_id = ? AND is_active = 1 LIMIT 1', [device.merchant_id]);
      receivingAccountId = activeAccount?.id || '00000000-0000-0000-0000-000000000002';
    }

    const boundAccount=ctx.db.queryOne('SELECT merchant_id FROM payment_receiving_accounts WHERE id=?',[receivingAccountId]);
    if(!boundAccount || boundAccount.merchant_id!==device.merchant_id) return HttpServer.json(res,403,{error:'Receiving account does not belong to this device merchant.'});

    // Extract amount and details: either pre-parsed or from raw bank SMS
    let amountPaise;
    try{amountPaise=body.amountPaise?BigInt(body.amountPaise):undefined;}catch{return HttpServer.json(res,400,{error:'Invalid observation amount'});}
    let bankRef = body.bankReferenceNumber || body.utr;
    let senderVpa = body.senderVpa;
    let observedAt = body.observedAt ? new Date(body.observedAt) : new Date();

    // Check for raw SMS text inside body or rawNotification
    const rawText = body.body || body.sms || body.rawSms || body.message || body.text || [body.rawNotification?.title,body.rawNotification?.text].filter(x=>typeof x==='string').join('\n');
    if(rawText&&rawText.length>MAX_OBSERVATION_TEXT_CHARS)return HttpServer.json(res,413,{error:'Observation text too long'});
    if (rawText && (!amountPaise || !bankRef)) {
      const parsedSms = BankSmsParser.parse({
        text: rawText,
        sender: body.sender || body.rawNotification?.package,
        timestamp: observedAt
      });

      if (parsedSms) {
        if (!amountPaise) amountPaise = parsedSms.amountPaise;
        if (!bankRef && parsedSms.bankReferenceNumber) bankRef = parsedSms.bankReferenceNumber;
        if (!senderVpa && parsedSms.senderVpa) senderVpa = parsedSms.senderVpa;
      }
    }

    if (!amountPaise && body.amount) {
      try {
        amountPaise = toPaise(body.amount);
      } catch {}
    }

    if(receiverBinding&&ctx.receivingMirror){
      try{
        const parsed=rawText?BankSmsParser.parse({text:rawText,sender:body.sender||'ANDROID_NOTIFICATION',timestamp:observedAt}):null;
        if(!parsed)return HttpServer.json(res,200,{accepted:true,status:'NON_PAYMENT_ALERT'});
        const sourceEvidence=body.sourceEvidence||null;
        ctx.receivingMirror.observeSource(device.merchant_id,device.id,sourceEvidence);
        if(!ctx.receivingMirror.sourceTrusted(device.merchant_id,sourceEvidence))return HttpServer.json(res,200,{accepted:true,status:'UNTRUSTED_SOURCE',message:'Super Admin must approve this app certificate or bank SMS sender before payment acceptance'});
        const detection=ctx.receivingMirror.record({device,accountId:receivingAccountId,source:'ANDROID_OBSERVER',sourceEvidence,rawText,observedAt,amountPaise:parsed.amountPaise,bankReference:parsed.bankReferenceNumber||null});
        ctx.db.execute('UPDATE android_devices SET last_observation_at=? WHERE id=?',[new Date().toISOString(),deviceId]);
        return HttpServer.json(res,200,{accepted:true,status:detection.matchStatus==='NOTIFICATION_CONFIRMED'?'SUCCESS':'VERIFICATION_PENDING',detection});
      }catch(error){return HttpServer.json(res,error.statusCode||503,{error:error.statusCode?error.message:'Receiving mirror unavailable; retry the same observation'});}
    }

    // Evaluate through Security & Fraud Verification Pipeline for Android Ingest
    if (ctx.pipeline && rawText) {
      const pipeResult = ctx.pipeline.process({
        source: 'SMS',
        receivedAt:body.observedAt||body.timestamp,
        rawText,
        sender: body.sender || req.headers['x-sender'],
        receivingAccountId,
        paymentSessionId: body.paymentSessionId,
        isTest: false, // device-supplied flags must never relax verification
        deviceInfo: device ? `${device.device_name} (${device.device_model})` : 'Android SMS Gateway'
      });

      if (pipeResult.status === 'REJECTED' && pipeResult.failingCondition === 'FRAUDULENT_PAYMENT_INJECTION') {
        HttpServer.json(res, 403, {
          accepted: false,
          status: 'REJECTED',
          reason: 'FRAUDULENT_PAYMENT_INJECTION',
          threatDetected: true,
          banned: true,
          error: 'FRAUDULENT_PAYMENT_INJECTION: Fake SMS detected. Associated customer identity banned and session terminated.'
        });
        return;
      }

      if(['REJECTED','SUSPICIOUS'].includes(pipeResult.status)) return HttpServer.json(res,200,{accepted:false,status:pipeResult.status,reason:pipeResult.failingCondition||'OBSERVATION_NOT_VERIFIED',pipeline:pipeResult});

      if (pipeResult.status === 'VERIFIED') {
        ctx.db.execute("UPDATE android_devices SET last_observation_at = datetime('now') WHERE id = ?", [deviceId]);
        HttpServer.json(res, 200, {
          accepted: true,
          observationId: pipeResult.messageId || pipeResult.stages?.stage6?.details?.observationId,
          attribution: { ...pipeResult.stages?.stage6?.details, attributed:true, paymentSessionId:pipeResult.stages?.stage6?.details?.attributedSessionId, outcomeStatus:pipeResult.stages?.stage6?.outcomeStatus },
          pipeline: pipeResult
        });
        return;
      }
    }

    if(!rawText && process.env.NODE_ENV!=='test') return HttpServer.json(res,400,{accepted:false,error:'Raw bank evidence is required.'});

    // Transport Only Contract (Part D): The Android observer forwards all raw SMS.
    // If no monetary amount is extracted (e.g. personal, promotional, non-bank SMS),
    // update observation timestamp on device and return 200 PROCESSED_NON_BANK.
    if (!amountPaise) {
      ctx.db.execute("UPDATE android_devices SET last_observation_at = datetime('now') WHERE id = ?", [deviceId]);
      HttpServer.json(res, 200, {
        accepted: true,
        status: 'PROCESSED_NON_BANK',
        bankMatch: false,
        message: 'Raw SMS observation ingested and evaluated by server pipeline.'
      });
      return;
    }

    try {
      const normalized = ObservationNormalizer.normalize({
        source: 'ANDROID_OBSERVER', // Maps to Android SMS Observer source in system enums
        receivingAccountId,
        rawPayload: body,
        amountPaise,
        amount: body.amount || (Number(amountPaise) / 100).toFixed(2),
        observedAt,
        senderVpa,
        bankReferenceNumber: bankRef
      });

      const result = ctx.attributionEngine.processObservation(normalized);

      // Update device last observation timestamp
      ctx.db.execute('UPDATE android_devices SET last_observation_at = datetime(\'now\') WHERE id = ?', [deviceId]);

      HttpServer.json(res, 200, {
        accepted: true,
        observationId: result.observationId,
        attribution: result
      });
    } catch (err) {
      console.error('[Android SMS Ingest Error]:', err.message);
      HttpServer.json(res, 400, { error: err.message });
    }
  };

  server.post('/api/v1/pollers/android/events', handleAndroidSmsEvents);
  server.post('/api/v1/observers/sms', handleAndroidSmsEvents);

  // --- ANDROID HEARTBEAT HANDLER ---
  const handleAndroidHeartbeat = async (req, res) => {
    const raw=await HttpServer.parseRawBody(req);
    let body;try{body=JSON.parse(raw);}catch{return HttpServer.json(res,400,{error:'Invalid JSON'});}
    const deviceId=req.headers['x-device-id']||body.deviceId;
    const device=deviceId?ctx.db.queryOne('SELECT * FROM android_devices WHERE id=? AND is_active=1',[deviceId]):null;
    const timestamp=req.headers['x-timestamp'],signature=req.headers['x-signature'];
    if(!device||!timestamp||!signature||!Number.isFinite(Number(timestamp))||Math.abs(Date.now()-Number(timestamp))>60000||!verifyHmac(`${raw}:${timestamp}`,device.signing_key_hash,signature))return HttpServer.json(res,401,{error:'A paired device signature and current timestamp are required.'});
    ctx.db.execute("UPDATE android_devices SET last_heartbeat_at=datetime('now') WHERE id=?",[deviceId]);

    if(ctx.receivingMirror?.binding(deviceId)){
      server.broadcastSse('platform:operations','invalidate',{changed:true});
      server.broadcastSse('platform:merchant:'+device.merchant_id,'invalidate',{changed:true});
    }
    HttpServer.json(res, 200, {
      status: 'HEARTBEAT_ACK',
      timestamp: Date.now()
    });
  };

  server.post('/api/v1/pollers/android/heartbeat', handleAndroidHeartbeat);
  server.post('/api/v1/pollers/heartbeat', handleAndroidHeartbeat);
  server.post('/api/v1/observers/heartbeat', handleAndroidHeartbeat);

  // --- MERCHANT ADMIN: SMS GATEWAY PAIRING QR CODE & STATUS ---
  server.get('/api/v1/admin/sms-gateway/pair-qr', async (req, res) => {
    let merchant = req.query.merchantId ? (ctx.merchantRepo ? ctx.merchantRepo.findById(req.query.merchantId) : null) : null;
    if (!merchant && ctx.merchantRepo) merchant = ctx.merchantRepo.getDefault ? ctx.merchantRepo.getDefault() : (ctx.merchantRepo.findById('00000000-0000-0000-0000-000000000001') || ctx.merchantRepo.findAll()[0]);
    const merchantId = merchant ? merchant.id : (req.query.merchantId || '00000000-0000-0000-0000-000000000001');

    // Canonical runtime URL derivation (Part C2)
    const runtime = resolveRuntimeUrls(merchant?.branding || {});
    let baseUrl = runtime.apiUrl;
    if(req.query.gatewayUrl){
      try{
        const requested=new URL(req.query.gatewayUrl);
        if(requested.protocol!=='https:' || requested.username || requested.password || requested.pathname!=='/' || requested.search || requested.hash) throw new Error('Invalid URL');
        baseUrl=requested.origin;
      }catch{return HttpServer.json(res,400,{error:'Enter the public HTTPS gateway origin, without a path or credentials.'});}
    }
    const account=ctx.accountRepo.findActiveForMerchant(merchantId);
    if(!account)return HttpServer.json(res,409,{error:'Assign an active receiving account before phone pairing'});
    const token = ctx.receivingMirror?ctx.receivingMirror.issuePairing(merchantId,account.id,false).token:enrollmentSecret;
    const sessionId = crypto.randomUUID();
    const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes

    const pairingPayloadObj = {
      version: 'v1',
      type: 'YOUPI_SMS_GATEWAY_PAIR',
      serverUrl: baseUrl,
      gatewayUrl: baseUrl,
      apiBaseUrl: baseUrl,
      sessionId,
      token,
      enrollmentToken: token,
      merchantId,
      createdAt: Date.now(),
      expiresAt
    };

    const pairingPayload = JSON.stringify(pairingPayloadObj);
    const qrSvg = generateQrSvg(pairingPayload, 260);

    const rawDevices = ctx.db.query(`
      SELECT id, device_name, device_model, is_active, last_heartbeat_at, last_observation_at, created_at
      FROM android_devices
      WHERE merchant_id = ?
      ORDER BY created_at DESC
    `, [merchantId]);

    const devices = (rawDevices || []).map(d => ({
      id: d.id,
      deviceId: d.id,
      deviceName: d.device_name || d.device_model || 'Android Observer',
      device_name: d.device_name || d.device_model || 'Android Observer',
      deviceModel: d.device_model,
      device_model: d.device_model,
      isActive: Boolean(d.is_active),
      is_active: d.is_active,
      lastHeartbeatAt: d.last_heartbeat_at,
      last_heartbeat_at: d.last_heartbeat_at,
      lastObservationAt: d.last_observation_at,
      last_observation_at: d.last_observation_at,
      createdAt: d.created_at,
      created_at: d.created_at,
      pairedAt: d.created_at
    }));

    HttpServer.json(res, 200, {
      qrSvg,
      pairingQrSvg: qrSvg,
      pairingPayload,
      payload: pairingPayloadObj,
      sessionId,
      expiresAt,
      version: 'v1',
      token,
      enrollmentToken: token,
      gatewayUrl: baseUrl,
      serverUrl: baseUrl,
      devices
    });
  });

  // GET /api/v1/admin/sms-gateway/devices
  server.get('/api/v1/admin/sms-gateway/devices', async (req, res) => {
    let merchant = req.query.merchantId ? (ctx.merchantRepo ? ctx.merchantRepo.findById(req.query.merchantId) : null) : null;
    if (!merchant && ctx.merchantRepo) merchant = ctx.merchantRepo.getDefault ? ctx.merchantRepo.getDefault() : (ctx.merchantRepo.findById('00000000-0000-0000-0000-000000000001') || ctx.merchantRepo.findAll()[0]);
    const merchantId = merchant ? merchant.id : (req.query.merchantId || '00000000-0000-0000-0000-000000000001');

    const rawDevices = ctx.db.query(`
      SELECT id, device_name, device_model, is_active, last_heartbeat_at, last_observation_at, created_at
      FROM android_devices
      WHERE merchant_id = ?
      ORDER BY created_at DESC
    `, [merchantId]);

    const devices = (rawDevices || []).map(d => ({
      id: d.id,
      deviceId: d.id,
      deviceName: d.device_name || d.device_model || 'Android Observer',
      device_name: d.device_name || d.device_model || 'Android Observer',
      deviceModel: d.device_model,
      device_model: d.device_model,
      isActive: Boolean(d.is_active),
      is_active: d.is_active,
      lastHeartbeatAt: d.last_heartbeat_at,
      last_heartbeat_at: d.last_heartbeat_at,
      lastObservationAt: d.last_observation_at,
      last_observation_at: d.last_observation_at,
      createdAt: d.created_at,
      created_at: d.created_at,
      pairedAt: d.created_at
    }));

    HttpServer.json(res, 200, { devices });
  });

  // DELETE /api/v1/admin/sms-gateway/devices/:deviceId
  server.delete('/api/v1/admin/sms-gateway/devices/:deviceId', async (req, res, params) => {
    const deviceId = params.deviceId;
    ctx.db.execute('DELETE FROM android_devices WHERE id = ?', [deviceId]);
    HttpServer.json(res, 200, { success: true, message: 'Device unlinked.' });
  });

  // GET /api/v1/admin/sms-gateway/download-apk & GET /youpi-sms-gateway.apk
  const serveApk = async (req, res) => {
    const apkLocations = [
      path.resolve(__dirname, '../../public/youpi-sms-gateway.apk'),
      path.resolve(__dirname, '../../../merchant-admin/public/youpi-sms-gateway.apk'),
      path.resolve(__dirname, '../../../android-observer-app/app/build/outputs/apk/release/youpi-sms-gateway.apk'),
      path.resolve(__dirname, '../../../android-observer-app/youpi-sms-gateway.apk')
    ];

    let foundPath = null;
    for (const p of apkLocations) {
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if(!foundPath || (process.env.NODE_ENV==='production' && !isCurrentAndroidRelease(foundPath,path.resolve(__dirname,'../../../..'))))return HttpServer.json(res,503,{error:'A current signed Android release has not been built and verified. The old APK is not distributed as the updated observer.',code:'ANDROID_BUILD_REQUIRED'});

    const stat = fs.statSync(foundPath);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="youpi-sms-gateway.apk"',
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(foundPath).pipe(res);
  };

  server.get('/api/v1/admin/sms-gateway/download-apk', serveApk);
  server.get('/youpi-sms-gateway.apk', serveApk);
}
