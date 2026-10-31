/**
 * Internal high-resolution payment session lifecycle states.
 */
export const PaymentStatus = Object.freeze({
  INITIATED: 'INITIATED',
  QUEUED: 'QUEUED',
  ACTIVE: 'ACTIVE',
  PROCESSING: 'PROCESSING',
  VERIFICATION_PENDING: 'VERIFICATION_PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
});

/**
 * Public-facing payment outcomes consumed by external merchants.
 */
export const PublicPaymentOutcome = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
});

/**
 * Supported payment modalities.
 */
export const PaymentMethod = Object.freeze({
  UPI: 'UPI',
  COD: 'COD',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  EMI: 'EMI',
  CASH_COUNTER: 'CASH_COUNTER',
  CARD_COUNTER: 'CARD_COUNTER'
});

/**
 * Merchant gateway selling modes.
 */
export const SellingMode = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE'
});

/**
 * Observation channel sources feeding the payment detection engine (2-Layer: SMS + Gmail).
 * Android observer layer is completely removed.
 */
export const ObserverSource = Object.freeze({
  GMAIL: 'GMAIL',
  GOOGLE_MESSAGES: 'GOOGLE_MESSAGES',
  ANDROID_OBSERVER: 'ANDROID_OBSERVER',
  SMS_GATEWAY: 'SMS_GATEWAY',
  MANUAL_COUNTER: 'MANUAL_COUNTER'
});

/**
 * Attribution status for raw observations.
 */
export const ObservationAttributionStatus = Object.freeze({
  UNATTRIBUTED: 'UNATTRIBUTED',
  ATTRIBUTED: 'ATTRIBUTED',
  LATE_UNMATCHED: 'LATE_UNMATCHED',
  DUPLICATE_IGNORED: 'DUPLICATE_IGNORED'
});

/**
 * Support ticket lifecycle states.
 */
export const TicketStatus = Object.freeze({
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED'
});

/**
 * Live chat message sender identity type.
 */
export const SenderType = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN'
});

/**
 * Audit log actor classifications.
 */
export const AuditActorType = Object.freeze({
  SYSTEM: 'SYSTEM',
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN',
  OBSERVER: 'OBSERVER'
});

/**
 * DYNAMO PAY UNIVERSAL UPI MIRROR — UPI connection lifecycle states.
 * A single CONNECTED badge must never imply authoritative bank verification.
 */
export const UpiConnectionState = Object.freeze({
  REGISTERED: 'REGISTERED',
  OWNERSHIP_PENDING: 'OWNERSHIP_PENDING',
  OBSERVER_PAIRING_REQUIRED: 'OBSERVER_PAIRING_REQUIRED',
  OBSERVER_CONNECTED: 'OBSERVER_CONNECTED',
  OBSERVATION_TESTED: 'OBSERVATION_TESTED',
  AUTHORITATIVE_VERIFIED: 'AUTHORITATIVE_VERIFIED',
  DEGRADED: 'DEGRADED',
  OFFLINE: 'OFFLINE',
  SUSPENDED: 'SUSPENDED',
  REVOKED: 'REVOKED'
});

/**
 * Merchant observer device pairing states.
 */
export const ObserverDevicePairingState = Object.freeze({
  PAIRING_REQUIRED: 'PAIRING_REQUIRED',
  PAIRING_PENDING: 'PAIRING_PENDING',
  PAIRED: 'PAIRED',
  REVOKED: 'REVOKED'
});

/**
 * UPI Mirror observation classification states.
 */
export const ObservationClassification = Object.freeze({
  PENDING: 'PENDING',
  OBSERVED: 'OBSERVED',
  MATCHED: 'MATCHED',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  UNKNOWN: 'UNKNOWN',
  REVERSED: 'REVERSED',
  DISPUTED: 'DISPUTED'
});

/**
 * UPI Mirror observation event directions.
 */
export const ObservationDirection = Object.freeze({
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND'
});

/**
 * UPI source categories for observer allowlisting.
 */
export const UpisourceCategory = Object.freeze({
  GOOGLE_PAY: 'GOOGLE_PAY',
  PHONEPE: 'PHONEPE',
  PAYTM: 'PAYTM',
  BHIM: 'BHIM',
  BANK_UPI: 'BANK_UPI',
  OTHER: 'OTHER'
});

/**
 * Payment evidence state machine (DYNAMO FLASH).
 * OBSERVED/MATCHED are notification evidence, NOT bank-confirmed success.
 * VERIFIED requires an authenticated authoritative bank/PSP record.
 */
export const PaymentEvidenceState = Object.freeze({
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  OBSERVED: 'OBSERVED',
  MATCHED: 'MATCHED',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  UNKNOWN: 'UNKNOWN',
  REVERSED: 'REVERSED',
  DISPUTED: 'DISPUTED'
});

/**
 * Webhook event types for UPI Mirror callbacks.
 */
export const UpiMirrorWebhookEvent = Object.freeze({
  PAYMENT_CREATED: 'payment.created',
  PAYMENT_OBSERVED: 'payment.observed',
  PAYMENT_MATCHED: 'payment.matched',
  PAYMENT_VERIFIED: 'payment.verified',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_EXCEPTION: 'payment.exception',
  PAYMENT_REVERSED: 'payment.reversed'
});
