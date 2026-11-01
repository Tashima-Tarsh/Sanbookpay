import { maskPhone, maskEmail, toRupeesString } from '@youpi/common';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export class ReceiptNotificationService {
  constructor(db, auditRepo, deliveryService=null) { this.db=db; this.auditRepo=auditRepo; this.deliveryService=deliveryService; }

  async sendPaymentReceipt(session, customer=null, merchant=null) {
    if (!session || session.status!=='SUCCESS') return null;
    const existing=this.getReceipt(session.id);
    if(existing)return existing;
    const amountRupees=toRupeesString(session.amountPaise ?? session.amount_paise);
    const bank=session.attributedObservationId?this.db.queryOne('SELECT bank_reference_number FROM payment_observations WHERE id=?',[session.attributedObservationId]):null;
    const provider=this.db.queryOne("SELECT bank_reference FROM payment_orders WHERE payment_session_id=? AND status='SUCCESS'",[session.id]);
    const manual=session.verificationTag==='MERCHANT_CONFIRMED'?this.db.queryOne('SELECT bank_reference FROM manual_payment_references WHERE payment_id=?',[session.id]):null;
    const isCod=session.method==='COD';
    const utr=isCod?null:(bank?.bank_reference_number||provider?.bank_reference||manual?.bank_reference||session.bankReference||session.bank_reference||(session.verificationTag==='NOTIFICATION_CONFIRMED'?session.metadata?.reportedUtr:null)||null);
    const confirmationSource=isCod?'ORDER_PLACED':provider?'PROVIDER':session.verificationTag==='NOTIFICATION_CONFIRMED'?'NOTIFICATION':session.verificationTag==='MERCHANT_CONFIRMED'?'MERCHANT':bank?'BANK_OBSERVER':'RECORDED';
    const orderId=session.orderId||session.order_id;
    const merchantName=merchant?.businessName||merchant?.business_name||'Dynamo Pay merchant';
    const phone=customer?.mobileNumber||customer?.mobile_number||session.metadata?.customerPhone;
    const email=customer?.email||session.metadata?.customerEmail;
    const receiptId='RCPT-'+session.id.toUpperCase();
    const generatedAt=new Date().toISOString();
    const maskedPhone=phone?maskPhone(phone):null,maskedEmail=email?maskEmail(email):null;
    const title=isCod?'Order placed: cash due on delivery':'Payment recorded';
    const rows=[['Receipt',receiptId],['Order',orderId],['Merchant',merchantName],['Amount (INR)',amountRupees],['Method',session.method||'UPI'],['Bank UTR:',utr||'Not supplied'],['Confirmation source',confirmationSource.replaceAll('_',' ')],['Customer',customer?.name||session.metadata?.customerName||'Not supplied'],['Phone',maskedPhone||'Not supplied'],['Email',maskedEmail||'Not supplied'],['Generated',generatedAt]];
    const emailHtml=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dynamo Pay receipt</title><body style="font-family:Segoe UI,Arial,sans-serif;color:#182c28;max-width:640px;margin:32px auto;padding:24px"><header style="border-bottom:2px solid #284d44;padding-bottom:20px"><strong>DYNAMO PAY</strong><h1 style="font-size:24px">${escapeHtml(title)}</h1></header><table style="width:100%;font-size:14px;border-collapse:collapse">${rows.map(([key,value])=>`<tr><th style="padding:12px 0;text-align:left;font-weight:400">${escapeHtml(key)}</th><td style="padding:12px 0;text-align:right;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join('')}</table><p style="font-size:12px">This receipt records the payment status in Dynamo Pay. Bank settlement is tracked separately. Email and SMS delivery are not configured.</p></body></html>`;
    const receipt={receiptId,sessionId:session.id,orderId,customerId:customer?.id||session.customerId||null,maskedPhone,maskedEmail,amountRupees,utr,method:session.method||'UPI',confirmationSource,emailSubject:`Dynamo Pay receipt: ${orderId}`,emailHtml,smsMessage:null,generatedAt,dispatchedAt:null,smsStatus:'NOT_CONFIGURED',emailStatus:'NOT_CONFIGURED'};
    this.db.transaction(()=>{
      if(this.deliveryService){
        receipt.emailHtml=receipt.emailHtml.replace(' Email and SMS delivery are not configured.','');
        receipt.smsMessage=isCod?`Sanbook Pay: order placed. INR ${amountRupees} due on delivery.`:`Sanbook Pay: payment recorded, INR ${amountRupees}. Bank settlement is tracked separately.`;
        Object.assign(receipt,this.deliveryService.enqueue(receipt,{email,phone}));
      }
      this.db.execute('INSERT OR IGNORE INTO payment_receipts(payment_id,receipt) VALUES(?,?)',[session.id,JSON.stringify(receipt)]);
      this.auditRepo?.log({merchantId:session.merchantId,entityType:'PAYMENT',entityId:session.id,action:'RECEIPT_GENERATED',actorType:'SYSTEM',details:{receiptId,confirmationSource}});
    });
    return this.getReceipt(session.id);
  }

  getReceipt(sessionId) { const row=this.db.queryOne('SELECT receipt FROM payment_receipts WHERE payment_id=?',[sessionId]);return row?JSON.parse(row.receipt):null; }
  async getOrCreateReceipt(session,customer=null,merchant=null) { return session.status==='SUCCESS'?(this.getReceipt(session.id)||this.sendPaymentReceipt(session,customer,merchant)):null; }
}
