import { Database } from '@youpi/db';
import { createUpiSimpleService } from '../services/upi-simple.js';

const db = new Database({ inMemory: true });

function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`FAIL: ${message} - expected ${expected}, got ${actual}`);
}

// Test 1: Register merchant with VPA
{
  const upiSimple = createUpiSimpleService({ db });
  const merchant = upiSimple.registerMerchant('m1', 'merchant@upi', 'https://game.example.com/callback');
  assert(merchant.upiVpa === 'merchant@upi', 'merchant VPA stored');
  assert(merchant.callbackUrl === 'https://game.example.com/callback', 'callback URL stored');
  assert(typeof merchant.secret === 'string' && merchant.secret.length > 0, 'secret generated');
  console.log('PASS: register merchant');
}

// Test 2: Get merchant by ID
{
  const upiSimple = createUpiSimpleService({ db });
  upiSimple.registerMerchant('m1', 'merchant@upi', 'https://game.example.com/callback');
  const merchant = upiSimple.getMerchant('m1');
  assert(merchant.id === 'm1', 'merchant ID matches');
  assert(merchant.upiVpa === 'merchant@upi', 'VPA matches');
  console.log('PASS: get merchant by ID');
}

// Test 3: Get merchant by VPA
{
  const upiSimple = createUpiSimpleService({ db });
  upiSimple.registerMerchant('m1', 'merchant@upi', 'https://game.example.com/callback');
  const merchant = upiSimple.getMerchantByVpa('MERCHANT@UPI');
  assert(merchant.id === 'm1', 'VPA lookup case-insensitive');
  console.log('PASS: get merchant by VPA');
}

// Test 4: Create order
{
  const upiSimple = createUpiSimpleService({ db });
  upiSimple.registerMerchant('m1', 'merchant@upi', 'https://game.example.com/callback');
  const order = upiSimple.createOrder({ merchantId: 'm1', orderId: 'ORD-004', amount: '100.00' });
  assert(order.status === 'PENDING', 'order status PENDING');
  assert(order.amountPaise === 10000, 'amount in paise');
  assert(order.upiVpa === 'merchant@upi', 'order has payee VPA');
  assert(typeof order.qrUri === 'string' && order.qrUri.startsWith('upi://pay'), 'QR URI generated');
  assert(order.qrUri.includes('merchant%40upi'), 'QR contains encoded VPA');
  assert(order.qrUri.includes('ORD-004'), 'QR contains order ID');
  console.log('PASS: create order');
}

// Test 5: Get order
{
  const upiSimple = createUpiSimpleService({ db });
  upiSimple.registerMerchant('m1', 'merchant@upi', 'https://game.example.com/callback');
  upiSimple.createOrder({ merchantId: 'm1', orderId: 'ORD-005', amount: '100.00' });
  const order = upiSimple.getOrder('m1', 'ORD-005');
  assert(order.orderId === 'ORD-005', 'order ID matches');
  assert(order.status === 'PENDING', 'status is PENDING');
  assert(order.utr === null, 'no UTR yet');
  console.log('PASS: get order');
}

// Test 6: Record observation matches order
{
  const upiSimple = createUpiSimpleService({ db });
  upiSimple.registerMerchant('m1', 'merchant@upi', 'https://game.example.com/callback');
  upiSimple.createOrder({ merchantId: 'm1', orderId: 'ORD-001', amount: '100.00', callbackUrl: 'https://game.example.com/callback' });
  const result = upiSimple.recordObservation({
    merchantId: 'm1',
    orderId: 'ORD-001',
    amountPaise: 10000,
    utr: '123456789012',
    senderVpa: 'user@upi',
    source: 'ANDROID_OBSERVER',
    rawText: '₹100.00 credited'
  });
  assert(result.matched === true, 'observation matched');
  assert(result.status === 'SUCCESS', 'order status SUCCESS');
  assert(result.utr === '123456789012', 'UTR stored');
  const order = upiSimple.getOrder('m1', 'ORD-001');
  assert(order.status === 'SUCCESS', 'order is SUCCESS');
  assert(order.utr === '123456789012', 'UTR on order');
  console.log('PASS: record observation matches order');
}

// Test 7: Observation without orderId matches by amount
{
  const upiSimple = createUpiSimpleService({ db });
  upiSimple.registerMerchant('m2', 'merchant2@upi', 'https://game.example.com/callback');
  upiSimple.createOrder({ merchantId: 'm2', orderId: 'ORD-007', amount: '100.00' });
  const result = upiSimple.recordObservation({
    merchantId: 'm2',
    amountPaise: 10000,
    utr: '987654321012',
    senderVpa: 'user@upi',
    source: 'SMS'
  });
  assert(result.matched === true, 'observation matched by amount');
  assert(result.utr === '987654321012', 'UTR stored');
  console.log('PASS: match by amount');
}

// Test 8: Invalid UTR rejected
{
  const upiSimple = createUpiSimpleService({ db });
  upiSimple.registerMerchant('m3', 'merchant3@upi');
  upiSimple.createOrder({ merchantId: 'm3', orderId: 'ORD-008', amount: '100.00' });
  let threw = false;
  try {
    upiSimple.recordObservation({ merchantId: 'm3', amountPaise: 10000, utr: 'short' });
  } catch (e) {
    threw = e.statusCode === 400 && e.message.includes('UTR');
  }
  assert(threw, 'invalid UTR rejected');
  console.log('PASS: invalid UTR rejected');
}

// Test 9: List orders
{
  const upiSimple = createUpiSimpleService({ db });
  upiSimple.registerMerchant('m4', 'merchant4@upi', 'https://game.example.com/callback');
  upiSimple.createOrder({ merchantId: 'm4', orderId: 'ORD-009', amount: '100.00' });
  upiSimple.createOrder({ merchantId: 'm4', orderId: 'ORD-010', amount: '200.00' });
  const orders = upiSimple.listOrders('m4');
  assert(orders.length === 2, 'two orders listed');
  console.log('PASS: list orders');
}

// Test 10: Invalid VPA rejected on register
{
  const upiSimple = createUpiSimpleService({ db });
  let threw = false;
  try {
    upiSimple.registerMerchant('m5', 'not-a-vpa');
  } catch (e) {
    threw = e.statusCode === 400;
  }
  assert(threw, 'invalid VPA rejected');
  console.log('PASS: invalid VPA rejected');
}

console.log('All UPI simple tests passed');
