package com.sanbookpay.upiintent

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONObject
import java.util.*

/**
 * Encrypted local pending-payment store.
 *
 * Payments are persisted before the buyer switches to an external UPI app so that the SDK can
 * recover after Android process death, app backgrounding, or payment-application force-close.
 * Values are encrypted at rest using EncryptedSharedPreferences (AES256-GCM).
 */
class PendingPaymentStore(private val context: Context) {

    private const val PREFS_NAME = "sanbookpay_upi_intent_pending"
    private const val KEY_PREFIX = "pending_"
    private const val SUBMITTED_PREFIX = "submitted_"

    private val masterKeyAlias: String by lazy {
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
    }

    private val prefs: SharedPreferences by lazy {
        EncryptedSharedPreferences.create(
            PREFS_NAME,
            masterKeyAlias,
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /**
     * Persists a pending payment (encrypted at rest).
     */
    fun save(payment: PendingPayment) {
        prefs.edit()
            .putString("${KEY_PREFIX}${payment.paymentId}", paymentToJson(payment).toString())
            .apply()
    }

    /**
     * Loads a pending payment by payment id. Returns null if not found.
     */
    fun load(paymentId: String): PendingPayment? {
        val json = prefs.getString("${KEY_PREFIX}$paymentId", null) ?: return null
        return jsonToPayment(json)
    }

    /**
     * Returns all pending payments that have not been marked submitted.
     */
    fun loadAllUnsubmitted(): List<PendingPayment> {
        val results = mutableListOf<PendingPayment>()
        val all = prefs.all
        for ((key, value) in all) {
            if (key.startsWith(KEY_PREFIX)) {
                val encrypted = value as? String ?: continue
                val json = decryptValue(encrypted) ?: continue
                try {
                    val payment = jsonToPayment(json)
                    // Skip already-submitted payments.
                    if (prefs.getString("${SUBMITTED_PREFIX}${payment.paymentId}", null) != null) continue
                    results.add(payment)
                } catch (e: Exception) {
                    // ignore malformed entries
                }
            }
        }
        return results.sortedBy { it.createdAt }
    }

    /**
     * Marks a payment as submitted so it is not re-processed during recovery.
     */
    fun markSubmitted(paymentId: String) {
        prefs.edit().putString("${SUBMITTED_PREFIX}$paymentId", System.currentTimeMillis().toString()).apply()
    }

    /**
     * Increments the retry count for a pending payment.
     */
    fun incrementRetry(paymentId: String) {
        val payment = load(paymentId) ?: return
        val updated = payment.copy(retryCount = payment.retryCount + 1)
        save(updated)
    }

    fun remove(paymentId: String) {
        prefs.edit().remove("${KEY_PREFIX}$paymentId").remove("${SUBMITTED_PREFIX}$paymentId").apply()
    }

    fun cleanupExpired() {
        val cutoff = System.currentTimeMillis()
        val all = prefs.all
        for ((key, value) in all) {
            if (key.startsWith(KEY_PREFIX)) {
                val encrypted = value as? String ?: continue
                val json = decryptValue(encrypted) ?: continue
                try {
                    val payment = jsonToPayment(json)
                    if (payment.expiresAt <= cutoff) remove(payment.paymentId)
                } catch (e: Exception) {
                    remove(key.removePrefix(KEY_PREFIX))
                }
            }
        }
    }

    private fun paymentToJson(payment: PendingPayment): JSONObject {
        return JSONObject().apply {
            put("paymentId", payment.paymentId)
            put("attemptId", payment.attemptId)
            put("correlationId", payment.correlationId ?: JSONObject.NULL)
            put("merchantId", payment.merchantId ?: JSONObject.NULL)
            put("amountPaise", payment.amountPaise)
            put("currency", payment.currency)
            put("receivingVpa", payment.receivingVpa)
            put("upiUri", payment.upiUri)
            put("orderId", payment.orderId)
            put("createdAt", payment.createdAt)
            put("expiresAt", payment.expiresAt)
            put("returnId", payment.returnId)
            put("idempotencyKey", payment.idempotencyKey)
            put("status", payment.status)
            put("lastServerStatus", payment.lastServerStatus ?: JSONObject.NULL)
            put("retryCount", payment.retryCount)
        }
    }

    private fun jsonToPayment(json: String): PendingPayment {
        val o = JSONObject(json)
        return PendingPayment(
            paymentId = o.getString("paymentId"),
            attemptId = o.getString("attemptId"),
            correlationId = o.optString("correlationId", null).takeIf { it.isNotEmpty() },
            merchantId = o.optString("merchantId", null).takeIf { it.isNotEmpty() },
            amountPaise = o.getLong("amountPaise"),
            currency = o.optString("currency", "INR"),
            receivingVpa = o.getString("receivingVpa"),
            upiUri = o.getString("upiUri"),
            orderId = o.getString("orderId"),
            createdAt = o.getLong("createdAt"),
            expiresAt = o.getLong("expiresAt"),
            returnId = o.getString("returnId"),
            idempotencyKey = o.getString("idempotencyKey"),
            status = o.optString("status", "PENDING"),
            lastServerStatus = o.optString("lastServerStatus", null).takeIf { it.isNotEmpty() },
            retryCount = o.optInt("retryCount", 0)
        )
    }

    private fun decryptValue(value: String): String? {
        // EncryptedSharedPreferences already decrypts on read, so prefs.getString returns plaintext.
        return value
    }
}
