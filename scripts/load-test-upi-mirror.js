import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// Custom metrics
const eventIngestionLatency = new Trend('upi_event_ingestion_latency');
const matchingLatency = new Trend('upi_matching_latency');
const callbackLatency = new Trend('callback_latency');
const errorRate = new Rate('error_rate');
const duplicateSuppressionCount = new Counter('duplicate_suppression_count');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up to 100 VUs
    { duration: '5m', target: 100 },   // Stay at 100 VUs
    { duration: '2m', target: 300 },   // Ramp up to 300 VUs
    { duration: '5m', target: 300 },   // Stay at 300 VUs
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<750'],  // T4→T8 under 750ms
    'error_rate': ['rate<0.01'],          // <1% error rate
    'upi_event_ingestion_latency': ['p(95)<100'],  // T4→T5 under 100ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:6100';
const MERCHANT_ID = __ENV.MERCHANT_ID || '00000000-0000-0000-0000-000000000001';
const DEVICE_ID = __ENV.DEVICE_ID || 'dev_' + Math.random().toString(36).substring(2);

// Generate a device keypair for signing (simplified for load test)
function generateSignature(deviceId, timestamp, body) {
  // In production this would use the device's private key from Android Keystore
  // For load testing, we use a shared test secret
  return 'test_signature_' + deviceId + '_' + timestamp;
}

export default function () {
  const timestamp = Date.now().toString();
  const eventId = 'evt_load_' + timestamp + '_' + __VU + '_' + __ITER;

  const eventPayload = {
    eventId,
    source: 'com.phonepe.app',
    direction: 'INBOUND',
    amountPaise: 25000,
    currency: 'INR',
    referenceUtr: 'UTR' + timestamp.slice(-12),
    claimingReceivingIdentity: 'merchant@upi',
    notificationTimestamp: timestamp,
    deviceObservedTimestamp: timestamp,
    parserVersion: '1.0.0',
    eventSignature: null,
    fingerprintHash: 'fp_' + eventId
  };

  const body = JSON.stringify(eventPayload);
  const signature = generateSignature(DEVICE_ID, timestamp, body);

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': DEVICE_ID,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
    },
    timeout: '10s',
  };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/upi-mirror/events`, body, params);
  const ingestionLatency = Date.now() - start;

  eventIngestionLatency.add(ingestionLatency);

  const success = check(res, {
    'event accepted': (r) => r.status === 201 || r.status === 200,
    'ingestion under 100ms': (r) => ingestionLatency < 100,
    'has observationId': (r) => {
      try {
        const json = r.json();
        return json.observationId !== undefined;
      } catch { return false; }
    },
  });

  if (!success) {
    errorRate.add(1);
  }

  sleep(0.5); // 2 events/sec per VU
}

// Export summary for reporting
export function handleSummary(data) {
  return {
    'output/testing/load-test-summary.json': JSON.stringify({
      timestamp: new Date().toISOString(),
      totalChecks: data.metrics.checks?.values?.passes || 0,
      failedChecks: data.metrics.checks?.values?.fails || 0,
      p95IngestionLatency: data.metrics.upi_event_ingestion_latency?.values?.p95 || 0,
      p99IngestionLatency: data.metrics.upi_event_ingestion_latency?.values?.p99 || 0,
      errorRate: data.metrics.error_rate?.values?.rate || 0,
    }, null, 2),
  };
}
