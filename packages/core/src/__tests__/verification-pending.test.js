import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Database,runMigrations,PaymentSessionRepository,ObservationRepository} from '@youpi/db';
import {AttributionEngine,ObservationNormalizer} from '../index.js';

test('reported UTR alone never settles a payment; a delayed matching bank observation does',()=>{
  const db=new Database({inMemory:true});runMigrations(db);
  const sessions=new PaymentSessionRepository(db),observations=new ObservationRepository(db);
  const account='00000000-0000-0000-0000-000000000002';
  const p=sessions.create({merchantId:'00000000-0000-0000-0000-000000000001',receivingAccountId:account,orderId:'DELAYED-BANK',amountPaise:400,status:'PROCESSING',metadata:{reportedUtr:'630414503470'}});
  sessions.transitionToVerificationPending(p.id);assert.equal(sessions.findById(p.id).status,'VERIFICATION_PENDING');
  const events=[];const engine=new AttributionEngine({sessionRepo:sessions,obsRepo:observations,eventEmitter:{emit:(name)=>events.push(name)},gracePeriodMs:0});
  const observation=ObservationNormalizer.normalize({source:'GMAIL',receivingAccountId:account,amount:'4.00',bankReferenceNumber:'630414503470',observedAt:new Date(),rawPayload:{text:'INR 4.00 credited. UTR 630414503470'}});
  const result=engine.processObservation(observation);
  assert.equal(result.attributed,true);assert.equal(sessions.findById(p.id).status,'SUCCESS');assert.ok(events.includes('PAYMENT.SUCCESS'));
  engine.destroy();db.close();
});
test('a different bank reference cannot settle an awaiting-verification order',()=>{
  const db=new Database({inMemory:true});runMigrations(db);
  const sessions=new PaymentSessionRepository(db),observations=new ObservationRepository(db),account='00000000-0000-0000-0000-000000000002';
  const p=sessions.create({merchantId:'00000000-0000-0000-0000-000000000001',receivingAccountId:account,orderId:'WRONG-REFERENCE',amountPaise:400,status:'PROCESSING',metadata:{reportedUtr:'630414503470'}});
  sessions.transitionToVerificationPending(p.id);
  const engine=new AttributionEngine({sessionRepo:sessions,obsRepo:observations,gracePeriodMs:0});
  const result=engine.processObservation(ObservationNormalizer.normalize({source:'GMAIL',receivingAccountId:account,amount:'4.00',bankReferenceNumber:'999999999999',observedAt:new Date(),rawPayload:{text:'INR 4 credited'}}));
  assert.equal(result.attributed,false);assert.equal(sessions.findById(p.id).status,'VERIFICATION_PENDING');engine.destroy();db.close();
});
test('an ambiguous bank credit is held, then reconciled from the saved bank record when its UTR is supplied',()=>{
  const db=new Database({inMemory:true});runMigrations(db);const sessions=new PaymentSessionRepository(db),observations=new ObservationRepository(db),account='00000000-0000-0000-0000-000000000002',merchantId='00000000-0000-0000-0000-000000000001';
  const pending=sessions.create({merchantId,receivingAccountId:account,orderId:'OLD-PENDING',amountPaise:400,status:'PROCESSING',metadata:{reportedUtr:'111111111111'}});sessions.transitionToVerificationPending(pending.id);
  const active=sessions.create({merchantId,receivingAccountId:account,orderId:'NEW-ACTIVE',amountPaise:400});sessions.acquireSlotAtomic(active.id,account);
  const engine=new AttributionEngine({sessionRepo:sessions,obsRepo:observations,gracePeriodMs:0});
  const bank=ObservationNormalizer.normalize({source:'GMAIL',receivingAccountId:account,amount:'4.00',bankReferenceNumber:'630414503470',observedAt:new Date(),rawPayload:{text:'INR 4 credited'}});
  assert.equal(engine.processObservation(bank).attributed,false);assert.equal(sessions.findById(active.id).status,'ACTIVE');
  db.execute('UPDATE payment_sessions SET metadata=? WHERE id=?',[JSON.stringify({reportedUtr:'630414503470'}),pending.id]);
  assert.equal(engine.reconcilePendingPayment(pending.id).attributed,true);assert.equal(sessions.findById(pending.id).status,'SUCCESS');assert.equal(sessions.findById(active.id).status,'ACTIVE');
  assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_observations').n,1);engine.destroy();db.close();
});
test('bank confirmation of a merchant-confirmed receipt cannot credit a newer same-amount order',()=>{
  const db=new Database({inMemory:true});runMigrations(db);const sessions=new PaymentSessionRepository(db),observations=new ObservationRepository(db),account='00000000-0000-0000-0000-000000000002',merchantId='00000000-0000-0000-0000-000000000001';
  const confirmed=sessions.create({merchantId,receivingAccountId:account,orderId:'MERCHANT-RECEIPT',amountPaise:400,status:'SUCCESS',metadata:{reportedUtr:'630414503470'}});
  db.execute("UPDATE payment_sessions SET verification_tag='MERCHANT_CONFIRMED' WHERE id=?",[confirmed.id]);
  const active=sessions.create({merchantId,receivingAccountId:account,orderId:'NEXT-ORDER',amountPaise:400});sessions.acquireSlotAtomic(active.id,account);
  const events=[];const engine=new AttributionEngine({sessionRepo:sessions,obsRepo:observations,eventEmitter:{emit:event=>events.push(event)},gracePeriodMs:0});
  const bank=ObservationNormalizer.normalize({source:'SMS_GATEWAY',receivingAccountId:account,amount:'4.00',bankReferenceNumber:'630414503470',observedAt:new Date(),rawPayload:{text:'INR 4 credited'}});
  assert.equal(engine.processObservation(bank).paymentSessionId,confirmed.id);assert.equal(sessions.findById(active.id).status,'ACTIVE');assert.equal(events.includes('PAYMENT.SUCCESS'),false);assert.ok(events.includes('PAYMENT.VERIFICATION_UPGRADED'));engine.destroy();db.close();
});
