package com.dynamopay.bridge

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import androidx.security.crypto.EncryptedSharedPreferences
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.util.concurrent.TimeUnit

const val PREFS_LAST_FORWARD_ATTEMPT = "last_forward_attempt"
const val PREFS_CONSECUTIVE_FAILURES = "consecutive_failures"
const val MAX_FORWARD_RETRIES = 5
const val FORWARD_RETRY_BASE_MS = 5000

data class ForwardResult(
    val success: Boolean,
    val statusCode: Int?,
    val error: String?,
    val eventId: String
)

/**
 * Event forwarder: immediately forwards queued observations to the backend
 * with signed transport, retry logic, and duplicate suppression.
 */
class EventForwarder(
    private val context: Context,
    private val cryptoHelper: CryptoHelper,
    private val securePrefs: SharedPreferences,
    private val eventQueue: EventQueue
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val handler = Handler(Looper.getMainLooper())
    private var isForwarding = false

    fun forwardPendingEvents(baseUrl: String, deviceId: String, signingKey: String): List<ForwardResult> {
        val results = mutableListOf<ForwardResult>()
        val pending = eventQueue.getPendingEvents(50)

        for (event in pending) {
            if (isDuplicateRecently(event.eventId)) {
                eventQueue.removeEvent(event.id)
                results.add(ForwardResult(true, 200, null, event.eventId))
                continue
            }

            val result = forwardSingleEvent(baseUrl, deviceId, signingKey, event)
            results.add(result)

            if (result.success) {
                eventQueue.removeEvent(event.id)
                recordForwardSuccess()
            } else {
                eventQueue.incrementAttempts(event.id)
                if (event.attempts >= MAX_FORWARD_RETRIES) {
                    eventQueue.removeEvent(event.id)
                }
            }

            Thread.sleep(100)
        }

        return results
    }

    private fun forwardSingleEvent(
        baseUrl: String,
        deviceId: String,
        signingKey: String,
        event: QueuedEvent
    ): ForwardResult {
        val timestamp = System.currentTimeMillis().toString()
        val url = "$baseUrl/api/v1/upi-mirror/events"

        val bodyJson = JSONObject().apply {
            put("eventId", event.eventId)
            put("source", event.source)
            put("direction", event.direction)
            put("amountPaise", event.amountPaise)
            put("currency", event.currency)
            put("referenceUtr", event.referenceUtr ?: JSONObject.NULL)
            put("claimingReceivingIdentity", event.claimingReceivingIdentity ?: JSONObject.NULL)
            put("notificationTimestamp", event.notificationTimestamp ?: JSONObject.NULL)
            put("deviceObservedTimestamp", event.deviceObservedTimestamp)
            put("serverReceivedTimestamp", event.serverReceivedTimestamp ?: JSONObject.NULL)
            put("parserVersion", event.parserVersion ?: JSONObject.NULL)
            put("eventSignature", event.eventSignature ?: JSONObject.NULL)
            put("fingerprintHash", event.fingerprintHash)
        }

        val bodyString = bodyJson.toString()
        val sigPayload = "$deviceId:$timestamp:$bodyString"
        val signature = cryptoHelper.hmacSha256(sigPayload, signingKey) ?: ""

        val request = Request.Builder()
            .url(url)
            .addHeader("X-Device-Id", deviceId)
            .addHeader("X-Timestamp", timestamp)
            .addHeader("X-Signature", signature)
            .addHeader("Content-Type", "application/json")
            .post(bodyString.toRequestBody("application/json".toMediaType()))
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                val success = response.isSuccessful
                ForwardResult(
                    success = success,
                    statusCode = response.code,
                    error = if (success) null else response.message,
                    eventId = event.eventId
                )
            }
        } catch (e: Exception) {
            e.printStackTrace()
            ForwardResult(false, null, e.message, event.eventId)
        }
    }

    fun startPeriodicForwarding(baseUrl: String, deviceId: String, signingKey: String, intervalMs: Long = 5000) {
        if (isForwarding) return
        isForwarding = true

        handler.post(object : Runnable {
            override fun run() {
                if (!isForwarding) return
                try {
                    forwardPendingEvents(baseUrl, deviceId, signingKey)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                handler.postDelayed(this, intervalMs)
            }
        })
    }

    fun stopPeriodicForwarding() {
        isForwarding = false
        handler.removeCallbacksAndMessages(null)
    }

    private fun isDuplicateRecently(eventId: String): Boolean {
        val key = "recent_event_$eventId"
        val existing = securePrefs.getString(key, null)
        if (existing != null) return true
        securePrefs.edit().putString(key, System.currentTimeMillis().toString()).apply()
        return false
    }

    private fun recordForwardSuccess() {
        securePrefs.edit()
            .putLong(PREFS_LAST_FORWARD_ATTEMPT, System.currentTimeMillis())
            .putInt(PREFS_CONSECUTIVE_FAILURES, 0)
            .apply()
    }

    fun recordForwardFailure() {
        securePrefs.edit()
            .putInt(PREFS_CONSECUTIVE_FAILURES,
                securePrefs.getInt(PREFS_CONSECUTIVE_FAILURES, 0) + 1)
            .apply()
    }

    fun getConsecutiveFailures(): Int {
        return securePrefs.getInt(PREFS_CONSECUTIVE_FAILURES, 0)
    }
}

