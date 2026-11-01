import http from 'node:http';

const BASE = 'http://localhost:6100';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(url, opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  return fn()
    .then(() => {
      console.log(`PASS: ${name}`);
      passed++;
    })
    .catch((e) => {
      console.log(`FAIL: ${name} - ${e.message}`);
      failed++;
    });
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log('=== E2E TEST: Super Admin to Payment Complete ===\n');

  // Step 1: Register merchant "ashu" via UPI simple setup
  await test('1. Register merchant ashu via UPI setup', async () => {
    const res = await request('POST', '/api/v1/upi/merchant/setup', {
      merchantId: 'ashu',
      upiVpa: 'ashu@upi',
      callbackUrl: 'https://gamebackend.example.com/upi-callback',
      businessName: 'ashu',
      contactEmail: 'niku906099@gmail.com',
      contactPhone: '+919082843142',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.merchantId === 'ashu', 'merchantId mismatch');
    assert(res.body.upiVpa === 'ashu@upi', 'upiVpa mismatch');
    assert(res.body.webhookSecret, 'webhookSecret missing');
    assert(res.body.accessToken, 'accessToken missing');
    assert(res.body.accessLink === '/merchant/ashu', 'accessLink mismatch');
    console.log('   Merchant ID:', res.body.merchantId);
    console.log('   UPI VPA:', res.body.upiVpa);
    console.log('   Webhook Secret:', res.body.webhookSecret);
    console.log('   Access Token:', res.body.accessToken);
    console.log('   Access Link:', res.body.accessLink);
    global.merchant = res.body;
  });

  // Step 2: Get merchant details
  await test('2. Get merchant details', async () => {
    const res = await request('GET', '/api/v1/upi/merchant', null, {
      'x-merchant-id': 'ashu',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.upiVpa === 'ashu@upi', 'upiVpa mismatch');
    console.log('   Merchant:', res.body);
  });

  // Step 3: Create payment order
  await test('3. Create payment order ORDER-001', async () => {
    const res = await request('POST', '/api/v1/upi/orders', {
      orderId: 'ORDER-001',
      amount: '300.00',
      currency: 'INR',
      callbackUrl: 'https://gamebackend.example.com/upi-callback',
    }, {
      'x-merchant-id': 'ashu',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.status === 'PENDING', 'status should be PENDING');
    assert(res.body.amountPaise === 30000, 'amount should be 30000 paise');
    assert(res.body.upiVpa === 'ashu@upi', 'upiVpa mismatch');
    assert(res.body.qrUri.startsWith('upi://pay'), 'qrUri should be UPI link');
    console.log('   Order ID:', res.body.orderId);
    console.log('   Amount:', res.body.amountPaise, 'paise');
    console.log('   UPI VPA:', res.body.upiVpa);
    console.log('   QR URI:', res.body.qrUri);
    global.order1 = res.body;
  });

  // Step 4: Create second payment order
  await test('4. Create payment order ORDER-002', async () => {
    const res = await request('POST', '/api/v1/upi/orders', {
      orderId: 'ORDER-002',
      amount: '500.00',
      currency: 'INR',
      callbackUrl: 'https://gamebackend.example.com/upi-callback',
    }, {
      'x-merchant-id': 'ashu',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.status === 'PENDING', 'status should be PENDING');
    global.order2 = res.body;
  });

  // Step 5: Get order status (PENDING)
  await test('5. Get order ORDER-001 status (PENDING)', async () => {
    const res = await request('GET', '/api/v1/upi/orders/ORDER-001', null, {
      'x-merchant-id': 'ashu',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'PENDING', 'status should be PENDING');
    assert(res.body.utr === null, 'UTR should be null before payment');
    console.log('   Order status:', res.body.status);
    console.log('   UTR:', res.body.utr);
  });

  // Step 6: Simulate UPI notification - payment received (ORDER-001, ₹300)
  await test('6. Simulate UPI notification for ORDER-001 (₹300)', async () => {
    const res = await request('POST', '/api/v1/upi/notify', {
      orderId: 'ORDER-001',
      amountPaise: 30000,
      utr: '123456789012',
      senderVpa: 'customer@upi',
      source: 'ANDROID_OBSERVER',
      rawText: '₹300.00 credited to ashu@upi from customer@upi. UTR: 123456789012',
    }, {
      'x-merchant-id': 'ashu',
      'x-merchant-secret': global.merchant.webhookSecret,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.matched === true, 'observation should match order');
    assert(res.body.status === 'SUCCESS', 'status should be SUCCESS');
    assert(res.body.utr === '123456789012', 'UTR should match');
    console.log('   Matched:', res.body.matched);
    console.log('   Status:', res.body.status);
    console.log('   UTR:', res.body.utr);
    console.log('   Callback sent:', res.body.callback?.sent);
  });

  // Step 7: Verify order is now SUCCESS
  await test('7. Get order ORDER-001 status (SUCCESS)', async () => {
    const res = await request('GET', '/api/v1/upi/orders/ORDER-001', null, {
      'x-merchant-id': 'ashu',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'SUCCESS', 'status should be SUCCESS');
    assert(res.body.utr === '123456789012', 'UTR should be stored');
    console.log('   Order status:', res.body.status);
    console.log('   UTR:', res.body.utr);
    console.log('   Sender VPA:', res.body.senderVpa);
    console.log('   Completed at:', res.body.completedAt);
  });

  // Step 8: List all orders for merchant
  await test('8. List merchant orders', async () => {
    const res = await request('GET', '/api/v1/upi/orders', null, {
      'x-merchant-id': 'ashu',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.orders.length >= 2, 'Should have at least 2 orders');
    const order1 = res.body.orders.find((o) => o.orderId === 'ORDER-001');
    const order2 = res.body.orders.find((o) => o.orderId === 'ORDER-002');
    assert(order1.status === 'SUCCESS', 'ORDER-001 should be SUCCESS');
    assert(order2.status === 'PENDING', 'ORDER-002 should be PENDING');
    console.log('   ORDER-001:', order1.status);
    console.log('   ORDER-002:', order2.status);
  });

  // Step 9: Simulate UPI notification without orderId - match by amount (ORDER-002, ₹500)
  await test('9. Simulate UPI notification matching by amount (ORDER-002, ₹500)', async () => {
    const res = await request('POST', '/api/v1/upi/notify', {
      amountPaise: 50000,
      utr: '987654321012',
      senderVpa: 'customer2@upi',
      source: 'SMS',
      rawText: '₹500.00 credited to ashu@upi. UTR: 987654321012',
    }, {
      'x-merchant-id': 'ashu',
      'x-merchant-secret': global.merchant.webhookSecret,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.matched === true, 'observation should match by amount');
    assert(res.body.status === 'SUCCESS', 'status should be SUCCESS');
    console.log('   Matched by amount:', res.body.matched);
    console.log('   Order:', res.body.orderId);
  });

  // Step 10: Verify ORDER-002 is now SUCCESS
  await test('10. Get order ORDER-002 status (SUCCESS)', async () => {
    const res = await request('GET', '/api/v1/upi/orders/ORDER-002', null, {
      'x-merchant-id': 'ashu',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'SUCCESS', 'status should be SUCCESS');
    assert(res.body.utr === '987654321012', 'UTR should be stored');
    console.log('   Order status:', res.body.status);
    console.log('   UTR:', res.body.utr);
  });

  // Step 11: Test invalid UTR rejection
  await test('11. Reject invalid UTR', async () => {
    const res = await request('POST', '/api/v1/upi/notify', {
      orderId: 'ORDER-001',
      amountPaise: 30000,
      utr: 'short',
      senderVpa: 'customer@upi',
      source: 'ANDROID_OBSERVER',
    }, {
      'x-merchant-id': 'ashu',
      'x-merchant-secret': global.merchant.webhookSecret,
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.includes('UTR'), 'Error should mention UTR');
  });

  // Step 12: Test invalid merchant secret rejection
  await test('12. Reject invalid merchant secret', async () => {
    const res = await request('POST', '/api/v1/upi/notify', {
      orderId: 'ORDER-001',
      amountPaise: 30000,
      utr: '111111111111',
      senderVpa: 'customer@upi',
      source: 'ANDROID_OBSERVER',
    }, {
      'x-merchant-id': 'ashu',
      'x-merchant-secret': 'wrong-secret',
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Step 13: Test super admin routes exist
  await test('13. Super admin routes available', async () => {
    const res = await request('GET', '/api/v1/health');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'UP', 'Service should be UP');
    console.log('   Service status:', res.body.status);
  });

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
