import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startCheckoutServer } from '../index.js';
import { generateQrMatrix, generateQrSvg } from '../qr.js';

describe('Checkout Portal Integration Tests', () => {
  let serverInstance;
  let baseUrl;

  before(async () => {
    // Start on high test port (7199)
    serverInstance = await startCheckoutServer(7199);
    baseUrl = `http://localhost:${serverInstance.port}`;
  });

  after(async () => {
    await serverInstance.close();
  });

  function get(path) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${path}`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        });
      }).on('error', reject);
    });
  }

  describe('QR Generator', () => {
    test('generateQrMatrix creates 29x29 matrix with finder patterns', () => {
      const matrix = generateQrMatrix('upi://pay?pa=store@upi&am=200.00');
      assert.equal(matrix.length, 29);
      assert.equal(matrix[0].length, 29);

      // Verify top-left finder pattern corner
      assert.equal(matrix[0][0], 1);
      assert.equal(matrix[0][6], 1);
      assert.equal(matrix[6][0], 1);
      assert.equal(matrix[6][6], 1);
    });

    test('generateQrSvg creates clean, valid SVG markup', () => {
      const svg = generateQrSvg('upi://pay?pa=9082843142@slc&am=500.00', 240);
      assert.ok(svg.startsWith('<svg'));
      assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
      assert.ok(svg.includes('viewBox="0 0 240 240"'));
      assert.ok(svg.endsWith('</svg>'));
    });
  });

  describe('HTTP Endpoints', () => {
    test('GET /health returns UP', async () => {
      const res = await get('/health');
      assert.equal(res.status, 200);
      const json = JSON.parse(res.text);
      assert.equal(json.status, 'UP');
      assert.equal(json.service, 'checkout-portal');
    });

    test('GET /checkout/:id renders premium glassmorphism HTML with injected payment ID', async () => {
      const testPaymentId = 'pay_test_uuid_12345';
      const res = await get(`/checkout/${testPaymentId}`);
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));

      assert.ok(res.text.includes('<!DOCTYPE html>'));
      assert.ok(res.text.includes('name="viewport"'));
      assert.ok(res.text.includes('Dynamo Pay'));
      assert.ok(res.text.includes('dp-wrapper'));
      assert.ok(res.text.includes(testPaymentId));

      // INVARIANT: No legacy PC sidebar artifacts
      assert.equal(res.text.includes('ypg-pc-sidebar'), false);
      assert.equal(res.text.includes('preGatewayAuthView'), false);
      assert.equal(res.text.includes('authMobileInput'), false);
      assert.equal(res.text.includes('WhatsApp Mobile Number'), false);
    });

    test('GET /checkout/:id/qr.svg returns dynamic SVG image', async () => {
      const res = await get('/checkout/pay_test_uuid_12345/qr.svg');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('image/svg+xml'));
      assert.ok(res.text.includes('<svg'));
      assert.ok(res.text.includes('</svg>'));
    });

    test('GET /icons/:filename returns official Play Store icons with correct MIME type', async () => {
      const res = await get('/icons/gpay.png');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('image/png'));
      assert.ok(res.text.length > 500);

      const resPhonePe = await get('/icons/phonepe.png');
      assert.equal(resPhonePe.status, 200);
      assert.ok(resPhonePe.headers['content-type'].includes('image/png'));
    });

    test('GET /youpi.js and /sdk/youpi-checkout.js return official integration SDK with CORS', async () => {
      const resYoupi = await get('/youpi.js');
      assert.equal(resYoupi.status, 200);
      assert.ok(resYoupi.headers['content-type'].includes('application/javascript'));
      assert.ok(resYoupi.headers['access-control-allow-origin'], '*');
      assert.ok(resYoupi.text.includes('YoupiCheckout'));
      assert.ok(resYoupi.text.includes('data-youpi-pay'));
      assert.ok(resYoupi.text.includes('youpi:payment:success'));

      const resLegacy = await get('/sdk/youpi-checkout.js');
      assert.equal(resLegacy.status, 200);
      assert.ok(resLegacy.headers['content-type'].includes('application/javascript'));
      assert.ok(resLegacy.headers['access-control-allow-origin'], '*');
      assert.ok(resLegacy.text.includes('YoupiCheckout'));
    });

    test('GET /checkout/:id includes premium glassmorphism elements, UPI QR, and Dynamo Pay branding', async () => {
      const res = await get('/checkout/pay_test_uuid_12345');
      assert.equal(res.status, 200);

      // Verify Dynamo Pay branding
      assert.ok(res.text.includes('Dynamo Pay'));

      // Verify premium glassmorphism classes
      assert.ok(res.text.includes('dp-wrapper'));
      assert.ok(res.text.includes('dp-header'));
      assert.ok(res.text.includes('dp-amount-card'));
      assert.ok(res.text.includes('dp-qr-card'));
      assert.ok(res.text.includes('dp-qr-image'));
      assert.ok(res.text.includes('dp-btn-primary'));

      // Verify UPI provider icons referenced
      assert.ok(res.text.includes('/icons/gpay.png'));
      assert.ok(res.text.includes('/icons/phonepe.png'));
      assert.ok(res.text.includes('/icons/paytm.png'));

      // Verify payee VPA present (Dynamo Pay merchant UPI)
      assert.ok(res.text.includes('9082843142@slc'));

      // INVARIANT: No WhatsApp / legacy auth artifacts
      assert.equal(res.text.includes('preGatewayAuthView'), false);
      assert.equal(res.text.includes('WhatsApp Mobile Number'), false);
      assert.equal(res.text.includes('ypg-pc-sidebar'), false);
    });
  });
});
