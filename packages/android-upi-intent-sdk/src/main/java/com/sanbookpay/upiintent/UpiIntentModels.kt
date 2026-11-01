package com.sanbookpay.upiintent

/**
 * Result of a UPI payment attempt as reported by the buyer-side Android client.
 *
 * This is buyer-reported payment information only. It is NOT bank-confirmed settlement.
 * The server must independently verify before marking a payment PAID_VERIFIED.
 */
data class UpiPaymentReturn(
    /** Unique identifier for this return event (client-generated). */
    val returnId: String,
    /** The payment attempt ID correlated to the server-created payment. */
    val attemptId: String,
    /** The server-generated payment ID. */
    val paymentId: String,
    /** Correlation ID for tracing across signals. */
    val correlationId: String?,
    /** Platform that originated the return (e.g. "ANDROID", "WEB"). */
    val sourcePlatform: String?,
    /** Identity of the UPI app that handled the payment, when reliably available. */
    val appIdentity: String?,
    /** Raw result string/extras returned by the UPI app (may be null or malformed). */
    val rawResult: String?,
    /** Parsed/normalized status: SUCCESS, FAILED, PENDING, CANCELLED, UNKNOWN, UNSUPPORTED. */
    val parsedStatus: String,
    /** UPI transaction reference (UTR) when available from the app response. */
    val upiTransactionReference: String?,
    /** Event timestamp from the client device. */
    val eventTimestamp: Long,
    /** Idempotency key to prevent duplicate processing. */
    val idempotencyKey: String,
    /** Additional metadata (merchant order id, amount, currency, VPA, etc.). */
    val metadata: Map<String, String> = emptyMap()
)

/**
 * Normalized status after parsing a UPI app response.
 */
enum class UpiStatus {
    SUCCESS,
    FAILED,
    PENDING,
    CANCELLED,
    UNKNOWN,
    UNSUPPORTED
}

/**
 * Result of launching a UPI payment intent.
 */
sealed class UpiLaunchResult {
    data object IntentLaunched : UpiLaunchResult()
    data class NoCompatibleApp(val packageName: String?) : UpiLaunchResult()
    data class LaunchFailure(val exception: Exception) : UpiLaunchResult()
}

/**
 * Result of capturing a payment return from the Android framework.
 */
sealed class UpiCaptureResult {
    data class Returned(val paymentReturn: UpiPaymentReturn) : UpiCaptureResult()
    data object NoReturn : UpiCaptureResult()
    data class InvalidFormat(val reason: String) : UpiCaptureResult()
    data object DuplicateReturn : UpiCaptureResult()
}

/**
 * Result of submitting a return to the server.
 */
sealed class UpiSubmitResult {
    data class Accepted(val serverStatus: String, val eventId: String?) : UpiSubmitResult()
    data class Duplicate(val existingEventId: String) : UpiSubmitResult()
    data class Failure(val exception: Exception) : UpiSubmitResult()
}

/**
 * A pending payment stored locally (encrypted) while the buyer completes payment externally.
 */
data class PendingPayment(
    val paymentId: String,
    val attemptId: String,
    val correlationId: String?,
    val merchantId: String?,
    val amountPaise: Long,
    val currency: String,
    val receivingVpa: String,
    val upiUri: String,
    val orderId: String,
    val createdAt: Long,
    val expiresAt: Long,
    val returnId: String,
    val idempotencyKey: String,
    val status: String = "PENDING",
    val lastServerStatus: String? = null,
    val retryCount: Int = 0
)

/**
 * Information about a discovered compatible UPI app.
 */
data class CompatibleUpiApp(
    val packageName: String,
    val appName: String?,
    val supportsGenericIntent: Boolean,
    val category: String? = null
)

/**
 * Server payment status response.
 */
data class ServerPaymentStatus(
    val paymentId: String,
    val orderId: String,
    val attemptId: String?,
    val status: String,
    val amountPaise: Long?,
    val currency: String?,
    val verificationLevel: Int?,
    val verified: Boolean
)
