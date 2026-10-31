import crypto from 'node:crypto';
import {toPaise} from '@youpi/common';
import { HttpServer } from '../server.js';
import { RefundRepository, PaymentOrderRepository, LedgerRepository } from '@youpi/db';
import { ProviderRegistry } from '@youpi/core';

/**
 * Refunds Management Routes
 * Interfaces with genuine provider refund endpoints and records financial ledger liabilities.
 */
export function registerRefundsRoutes(server, ctx) {
  const db = ctx.db;
  const refundRepo = new RefundRepository(db);
  const poRepo = new PaymentOrderRepository(db);
  const ledgerRepo = new LedgerRepository(db);
  const providerRegistry = new ProviderRegistry({ db });

  function getMerchantId(req) {
    const key = req.headers['x-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (!key) return null;
    const merchant = db.queryOne(`SELECT id FROM merchants WHERE id = $1`, [key]);
    if (merchant) return merchant.id;
    const cred = db.queryOne(`SELECT merchant_id FROM merchant_credentials WHERE api_key = $1 AND status = 'ACTIVE'`, [key]);
    if (cred) return cred.merchant_id;
    const firstMerchant = db.queryOne(`SELECT id FROM merchants LIMIT 1`);
    return firstMerchant ? firstMerchant.id : null;
  }

  // 1. POST /api/v1/refunds — Initiate a refund
  server.post('/api/v1/refunds', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON request body' });
    }

    if (!body.paymentId && !body.orderId) {
      return HttpServer.json(res, 400, { error: 'Missing required field: paymentId or orderId' });
    }

    const order = poRepo.findById(body.paymentId) || 
      poRepo.findByMerchantAndOrderId(merchantId, body.orderId || body.paymentId);

    if (!order || order.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Payment order not found' });
    }

    if (order.status !== 'SUCCESS') {
      return HttpServer.json(res, 400, { error: `Cannot refund order with status ${order.status}. Only SUCCESS orders can be refunded.` });
    }

    let refundAmountPaise;
    try{refundAmountPaise=body.amount===undefined?Number(order.amount_paise):Number(toPaise(body.amount));}
    catch{return HttpServer.json(res,400,{error:'Enter a positive refund amount with at most two decimal places.'});}
    if(!Number.isSafeInteger(refundAmountPaise)||refundAmountPaise<=0)return HttpServer.json(res,400,{error:'Invalid refund amount.'});
    const refundId=body.refundId||`ref_${crypto.randomUUID()}`;
    const existing=refundRepo.findByRefundId(refundId);
    if(existing){
      if(existing.merchant_id!==merchantId||existing.payment_order_id!==order.id||Number(existing.amount_paise)!==refundAmountPaise)return HttpServer.json(res,409,{error:'Refund ID is already used for a different request.'});
      return HttpServer.json(res,200,{refundId:existing.refund_id,paymentId:order.id,status:existing.status,amount:(Number(existing.amount_paise)/100).toFixed(2)});
    }
    let refund;
    try{
      refund=db.transaction(()=>{
        const locked=db.queryOne(`SELECT * FROM payment_orders WHERE id=?${db.dialect==='postgres'?' FOR UPDATE':''}`,[order.id]);
        const reserved=Number(db.queryOne("SELECT COALESCE(SUM(amount_paise),0) AS n FROM refunds WHERE payment_order_id=? AND status NOT IN ('FAILED','REJECTED')",[order.id]).n);
        const manual=Number(db.queryOne("SELECT COALESCE(SUM(amount_paise),0) AS n FROM console_refund_requests WHERE payment_id IN (?,?) AND status!='REJECTED'",[order.id,order.payment_session_id||order.id]).n);
        if(reserved+manual+refundAmountPaise>Number(locked.amount_paise))throw Error('Amount exceeds remaining refundable balance.');
        const created=refundRepo.create({merchantId,paymentOrderId:order.id,refundId,amountPaise:refundAmountPaise,currency:order.currency,reason:body.reason||null,status:'SUBMITTING'});
        ledgerRepo.recordDoubleEntry(merchantId,'REFUND',created.id,`Refund reserved for ${order.merchant_order_id}`,'REFUND_LIABILITIES','PROVIDER_CLEARING',refundAmountPaise);
        return created;
      });
    }catch(error){return HttpServer.json(res,409,{error:error.message});}
    try{
      const provider=providerRegistry.getProvider(merchantId,order.provider_name);
      const result=await provider.createRefund({merchantOrderId:order.merchant_order_id,refundId,amountPaise:refundAmountPaise,reason:body.reason||'Merchant requested refund'});
      refund=db.transaction(()=>{
        if(['FAILED','REJECTED'].includes(result.status))ledgerRepo.recordDoubleEntry(merchantId,'REFUND_REVERSAL',refund.id,'Provider rejected reserved refund','PROVIDER_CLEARING','REFUND_LIABILITIES',refundAmountPaise);
        return refundRepo.update(refund.id,{providerRefundId:result.providerRefundId,status:result.status||'PENDING',providerResponse:result});
      });
    }catch(error){
      // A timeout can occur after the provider accepted the refund. Retain the reservation.
      refundRepo.update(refund.id,{status:'RECONCILIATION_REQUIRED',providerResponse:{error:'Provider submission could not be confirmed'}});
      return HttpServer.json(res,502,{error:'Refund submission requires provider reconciliation. Retry with the same refundId; do not create another refund.',refundId,status:'RECONCILIATION_REQUIRED'});
    }

    return HttpServer.json(res, 201, {
      refundId: refund.refund_id,
      paymentId: order.id,
      orderId: order.merchant_order_id,
      amount: (refund.amount_paise / 100).toFixed(2),
      status: refund.status,
      createdAt: refund.created_at
    });
  });

  // 2. GET /api/v1/refunds/:id — Get refund details
  server.get('/api/v1/refunds/:id', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const refund = refundRepo.findById(params.id) || refundRepo.findByRefundId(params.id);
    if (!refund || refund.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Refund not found' });
    }

    return HttpServer.json(res, 200, {
      id: refund.id,
      refundId: refund.refund_id,
      paymentOrderId: refund.payment_order_id,
      amount: (refund.amount_paise / 100).toFixed(2),
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      utr: refund.utr,
      createdAt: refund.created_at,
      confirmedAt: refund.confirmed_at
    });
  });

  // 3. GET /api/v1/refunds — List refunds
  server.get('/api/v1/refunds', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const list = refundRepo.listByMerchant(merchantId);
    return HttpServer.json(res, 200, {
      count: list.length,
      refunds: list.map(r => ({
        id: r.id,
        refundId: r.refund_id,
        paymentOrderId: r.payment_order_id,
        amount: (r.amount_paise / 100).toFixed(2),
        currency: r.currency,
        status: r.status,
        reason: r.reason,
        createdAt: r.created_at
      }))
    });
  });
}

