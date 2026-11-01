package com.sanbookpay.upiintent

import android.content.Intent
import android.os.Bundle
import android.text.TextUtils
import org.json.JSONObject
import java.util.regex.Pattern

/**
 * Parses UPI app response data (Intent extras / URI) and normalizes the reported status.
 *
 * UPI apps return payment results in various formats:
 *   - Intent extras: Status, TxnRef, responseCode, message, txnId, Amount, etc.
 *   - Some apps return a deep-link/URI with query parameters.
 *   - Some return null/empty on cancellation.
 *   - Some return an unsupported/undocumented format.
 *
 * This parser is intentionally generic and app-agnostic. App-specific adapters are used
 * only where officially documented and justified.
 */
object UpiResponseParser {

    private const val TAG = "UpiResponseParser"

    // Common UPI status keys returned by apps in Intent extras.
    private val STATUS_KEYS = listOf("Status", "status", "txnStatus", "transactionStatus", "paymentStatus")
    private val REF_KEYS = listOf("TxnRef", "txnRef", "transactionRef", "txnId", "transactionId", "UTR", "utr", "refId")
    private val RESPONSE_CODE_KEYS = listOf("responseCode", "ResponseCode", "respCode", "code")

    /**
     * Parses an Android Intent returned from a UPI payment app into a [UpiPaymentReturn].
     * Returns [UpiCaptureResult.InvalidFormat] when the response cannot be interpreted.
     * Returns [UpiCaptureResult.NoReturn] when the intent carries no usable data.
     */
    fun parseIntentReturn(intent: Intent?, attemptId: String, paymentId: String, correlationId: String?,
                          sourcePlatform: String?, appIdentity: String?, idempotencyKey: String,
                          metadata: Map<String, String>): UpiCaptureResult {
        val nowMillis = System.currentTimeMillis()

        if (intent == null) {
            return UpiCaptureResult.Returned(
                UpiPaymentReturn(
                    returnId = generateReturnId(),
                    attemptId = attemptId,
                    paymentId = paymentId,
                    correlationId = correlationId,
                    sourcePlatform = sourcePlatform,
                    appIdentity = appIdentity,
                    rawResult = null,
                    parsedStatus = UpiStatus.UNKNOWN.name,
                    upiTransactionReference = null,
                    eventTimestamp = nowMillis,
                    idempotencyKey = idempotencyKey,
                    metadata = metadata
                )
            )
        }

        val extras = intent.extras
        val dataString = intent.dataString

        // Collect all candidate raw values for diagnostics.
        val rawParts = mutableListOf<String>()
        if (dataString != null) rawParts.add("uri=$dataString")
        if (extras != null) {
            for (key in extras.keySet()) {
                rawParts.add("$key=${extras.get(key)}")
            }
        }
        val rawResult = rawParts.joinToString("; ")

        // If there is genuinely no data, treat as a null/cancelled response.
        if ((extras == null || extras.size() == 0) && dataString.isNullOrBlank()) {
            return UpiCaptureResult.Returned(
                UpiPaymentReturn(
                    returnId = generateReturnId(),
                    attemptId = attemptId,
                    paymentId = paymentId,
                    correlationId = correlationId,
                    sourcePlatform = sourcePlatform,
                    appIdentity = appIdentity,
                    rawResult = rawResult.takeIf { it.isNotEmpty() } ?: null,
                    parsedStatus = UpiStatus.CANCELLED.name,
                    upiTransactionReference = null,
                    eventTimestamp = nowMillis,
                    idempotencyKey = idempotencyKey,
                    metadata = metadata
                )
            )
        }

        // Extract status from extras first.
        var statusValue: String? = null
        for (key in STATUS_KEYS) {
            statusValue = extraString(extras, key)
            if (statusValue != null) break
        }

        // Fall back to parsing the URI query parameters.
        if (statusValue == null && dataString != null) {
            statusValue = parseQueryParam(dataString, "status")
                ?: parseQueryParam(dataString, "txnStatus")
                ?: parseQueryParam(dataString, "paymentStatus")
        }

        // Extract reference/UTR.
        var reference: String? = null
        for (key in REF_KEYS) {
            reference = extraString(extras, key)
            if (reference != null && reference.isNotBlank()) break
        }
        if ((reference == null || reference.isBlank()) && dataString != null) {
            reference = parseQueryParam(dataString, "txnref")
                ?: parseQueryParam(dataString, "txnRef")
                ?: parseQueryParam(dataString, "utr")
                ?: parseQueryParam(dataString, "refId")
        }

        // Normalize status.
        val normalized = normalizeReportedStatus(statusValue, rawResult)

        // Detect unsupported format: we got data but no recognizable status/reference.
        if (normalized == UpiStatus.UNKNOWN && statusValue == null && reference == null && dataString == null) {
            return UpiCaptureResult.InvalidFormat("No recognizable UPI status or reference in response")
        }

        return UpiCaptureResult.Returned(
            UpiPaymentReturn(
                returnId = generateReturnId(),
                attemptId = attemptId,
                paymentId = paymentId,
                correlationId = correlationId,
                sourcePlatform = sourcePlatform,
                appIdentity = appIdentity,
                rawResult = rawResult.takeIf { it.isNotEmpty() } ?: null,
                parsedStatus = normalized.name,
                upiTransactionReference = reference.takeIf { it.isNotBlank() },
                eventTimestamp = nowMillis,
                idempotencyKey = idempotencyKey,
                metadata = metadata
            )
        )
    }

    /**
     * Normalizes a raw status string from a UPI app into a canonical [UpiStatus].
     *
     * Handles:
     *   - SUCCESS / success / "00" / "SUCCESS" -> SUCCESS
     *   - FAILED / failed / failure -> FAILED
     *   - PENDING / pending -> PENDING
     *   - CANCELLED / cancelled / user cancelled -> CANCELLED
     *   - null / empty / unrecognized -> UNKNOWN
     *   - undocumented formats -> UNSUPPORTED when clearly not a standard response
     */
    fun normalizeReportedStatus(raw: String?, rawResult: String?): UpiStatus {
        if (raw == null) {
            return UpiStatus.UNKNOWN
        }

        val trimmed = raw.trim()
        if (trimmed.isEmpty()) {
            return UpiStatus.UNKNOWN
        }

        val lower = trimmed.lowercase()

        // Exact numeric/short codes commonly used by banks/UPI apps.
        when (lower) {
            "success", "txn_success", "payment_success", "00", "0", "completed" -> return UpiStatus.SUCCESS
            "failed", "txn_failed", "payment_failed", "failure", "decline", "declined" -> return UpiStatus.FAILED
            "pending", "txn_pending", "processing", "initiated" -> return UpiStatus.PENDING
            "cancelled", "canceled", "user_cancelled", "user_canceled", "aborted" -> return UpiStatus.CANCELLED
        }

        // Substring matching for descriptive statuses.
        if (lower.contains("success") || lower.contains("completed")) return UpiStatus.SUCCESS
        if (lower.contains("fail") || lower.contains("decline") || lower.contains("error") || lower.contains("invalid")) {
            return UpiStatus.FAILED
        }
        if (lower.contains("pending") || lower.contains("process") || lower.contains("initiated")) {
            return UpiStatus.PENDING
        }
        if (lower.contains("cancel")) return UpiStatus.CANCELLED

        return UpiStatus.UNKNOWN
    }

    /**
     * Determines whether a response format is unsupported (not a recognized UPI response shape).
     * Callers should fall back to generic UPI handling when this is true.
     */
    fun isUnsupportedFormat(rawResult: String?, status: UpiStatus): Boolean {
        if (status == UpiStatus.UNSUPPORTED) return true
        if (rawResult == null || rawResult.isEmpty()) return false
        // If the raw result contains clearly non-UPI content (HTML, error pages, etc.)
        return rawResult.contains("<html") || rawResult.contains("<?xml") ||
            (rawResult.length > 4096 && status == UpiStatus.UNKNOWN)
    }

    private fun extraString(extras: Bundle?, key: String): String? {
        if (extras == null) return null
        return when {
            extras.containsKey(key) -> {
                val v = extras.get(key)
                if (v == null) null else v.toString()
            }
            else -> null
        }
    }

    private fun parseQueryParam(uri: String, param: String): String? {
        if (uri.isEmpty()) return null
        val qStart = uri.indexOf('?')
        if (qStart < 0) return null
        val query = uri.substring(qStart + 1)
        val pattern = Pattern.compile("(?:^|&)$param=([^&]*)", Pattern.CASE_INSENSITIVE)
        val m = pattern.matcher(query)
        return if (m.find()) m.group(1) else null
    }

    private fun generateReturnId(): String {
        return "ret_${System.currentTimeMillis()}_${java.util.UUID.randomUUID().toString().substring(0, 8)}"
    }
}
