package com.dynamopay.bridge

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import androidx.security.crypto.EncryptedSharedPreferences
import okhttp3.*
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.util.concurrent.TimeUnit

const val PREFS_DEVICE_ID = "dynamo_device_id"
const val PREFS_DEVICE_TOKEN = "dynamo_device_token"
const val PREFS_BASE_URL = "dynamo_base_url"
const val PREFS_PAIRED = "dynamo_paired"
const val PREFS_MERCHANT_ID = "dynamo_merchant_id"
const val PREFS_PAIRED_AT = "dynamo_paired_at"
const val PREFS_SUBSCRIPTION_STATUS = "dynamo_subscription_status"

data class DevicePairingResult(
    val paired: Boolean,
    val deviceId: String?,
    val deviceToken: String?,
    val merchantId: String?,
    val error: String?
)

data class DeviceHealth(
    val deviceId: String,
    val isActive: Boolean,
    val listenerStatus: String,
    val lastHeartbeat: Long?,
    val lastEventForwarded: Long?,
    val avgLatencyMs: Long?,
    val version: String
)

class ApiClient(
    private val context: Context,
    private val cryptoHelper: CryptoHelper,
    private val securePrefs: SharedPreferences
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val handler = Handler(Looper.getMainLooper())

    fun isPaired(): Boolean = securePrefs.getBoolean(PREFS_PAIRED, false)
    fun getDeviceId(): String? = securePrefs.getString(PREFS_DEVICE_ID, null)
    fun getDeviceToken(): String? = securePrefs.getString(PREFS_DEVICE_TOKEN, null)
    fun getBaseUrl(): String = securePrefs.getString(PREFS_BASE_URL, "https://api.dynamopay.example") ?: "https://api.dynamopay.example"
    fun getMerchantId(): String? = securePrefs.getString(PREFS_MERCHANT_ID, null)

    fun pairViaQr(qrPayload: String): DevicePairingResult {
        return try {
            val json = JSONObject(qrPayload)
            val merchantId = json.getString("merchantId")
            val challenge = json.getString("challenge")
            val baseUrl = json.optString("baseUrl", getBaseUrl())

            if (!cryptoHelper.ensureDeviceKeyPair()) {
                return DevicePairingResult(false, null, null, null, "Failed to generate device keys")
            }

            val publicKeyPem = cryptoHelper.getPublicKeyPem() ?: ""
            val deviceFingerprint = cryptoHelper.getDeviceFingerprint() ?: ""

            val pairingPayload = JSONObject().apply {
                put("merchantId", merchantId)
                put("challenge", challenge)
                put("deviceFingerprint", deviceFingerprint)
                put("publicKey", publicKeyPem)
                put("deviceModel", android.os.Build.MODEL)
                put("androidVersion", android.os.Build.VERSION.RELEASE)
                put("appVersion", "1.0.0")
            }

            val timestamp = System.currentTimeMillis().toString()
            val sigPayload = "$merchantId:$challenge:$timestamp:$pairingPayload"
            val hmacSecret = cryptoHelper.getHmacSecret() ?: ""
            val signature = cryptoHelper.hmacSha256(sigPayload, hmacSecret) ?: ""

            val url = "$baseUrl/api/v1/upi-mirror/pairing/confirm"
            val body = pairingPayload.toString()
            val request = Request.Builder()
                .url(url)
                .addHeader("Content-Type", "application/json")
                .addHeader("X-Timestamp", timestamp)
                .addHeader("X-Signature", signature)
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return DevicePairingResult(false, null, null, null, "Pairing failed: HTTP ${response.code}")
                }
                val respBody = response.body?.string() ?: ""
                val respJson = JSONObject(respBody)

                if (respJson.optBoolean("success", false)) {
                    val deviceId = respJson.getString("deviceId")
                    val deviceToken = respJson.optString("deviceToken", null)

                    securePrefs.edit()
                        .putBoolean(PREFS_PAIRED, true)
                        .putString(PREFS_DEVICE_ID, deviceId)
                        .putString(PREFS_DEVICE_TOKEN, deviceToken)
                        .putString(PREFS_BASE_URL, baseUrl)
                        .putString(PREFS_MERCHANT_ID, merchantId)
                        .putLong(PREFS_PAIRED_AT, System.currentTimeMillis())
                        .apply()

                    return DevicePairingResult(true, deviceId, deviceToken, merchantId, null)
                } else {
                    return DevicePairingResult(false, null, null, null, respJson.optString("error", "Pairing failed"))
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
            DevicePairingResult(false, null, null, null, e.message ?: "Pairing error")
        }
    }

    fun sendHeartbeat(): Boolean {
        if (!isPaired()) return false

        val deviceId = getDeviceId() ?: return false
        val baseUrl = getBaseUrl()
        val timestamp = System.currentTimeMillis().toString()

        val bodyJson = JSONObject().apply {
            put("deviceId", deviceId)
            put("timestamp", timestamp)
            put("listenerStatus", "ACTIVE")
            put("appVersion", "1.0.0")
        }

        val hmacSecret = cryptoHelper.getHmacSecret() ?: ""
        val sigPayload = "$deviceId:$timestamp:${bodyJson.toString()}"
        val signature = cryptoHelper.hmacSha256(sigPayload, hmacSecret) ?: ""

        val request = Request.Builder()
            .url("$baseUrl/api/v1/upi-mirror/devices/$deviceId/heartbeat")
            .addHeader("Content-Type", "application/json")
            .addHeader("X-Timestamp", timestamp)
            .addHeader("X-Signature", signature)
            .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
            .build()

        return try {
            client.newCall(request).execute().use { response -> response.isSuccessful }
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun syncSubscriptionStatus(): String? {
        if (!isPaired()) return null

        val deviceId = getDeviceId() ?: return null
        val baseUrl = getBaseUrl()
        val timestamp = System.currentTimeMillis().toString()

        val hmacSecret = cryptoHelper.getHmacSecret() ?: ""
        val sigPayload = "$deviceId:$timestamp"
        val signature = cryptoHelper.hmacSha256(sigPayload, hmacSecret) ?: ""

        val request = Request.Builder()
            .url("$baseUrl/api/v1/upi-mirror/subscription")
            .addHeader("X-Device-Id", deviceId)
            .addHeader("X-Timestamp", timestamp)
            .addHeader("X-Signature", signature)
            .get()
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val body = response.body?.string() ?: ""
                val json = JSONObject(body)
                val status = json.optString("status", null)
                securePrefs.edit().putString(PREFS_SUBSCRIPTION_STATUS, status ?: "UNKNOWN").apply()
                status
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun revokeDevice(): Boolean {
        if (!isPaired()) return false

        val deviceId = getDeviceId() ?: return false
        val baseUrl = getBaseUrl()
        val timestamp = System.currentTimeMillis().toString()

        val hmacSecret = cryptoHelper.getHmacSecret() ?: ""
        val sigPayload = "$deviceId:$timestamp"
        val signature = cryptoHelper.hmacSha256(sigPayload, hmacSecret) ?: ""

        val request = Request.Builder()
            .url("$baseUrl/api/v1/upi-mirror/devices/$deviceId")
            .addHeader("X-Timestamp", timestamp)
            .addHeader("X-Signature", signature)
            .delete()
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    securePrefs.edit()
                        .putBoolean(PREFS_PAIRED, false)
                        .remove(PREFS_DEVICE_ID)
                        .remove(PREFS_DEVICE_TOKEN)
                        .remove(PREFS_BASE_URL)
                        .remove(PREFS_MERCHANT_ID)
                        .remove(PREFS_PAIRED_AT)
                        .remove(PREFS_SUBSCRIPTION_STATUS)
                        .apply()
                }
                response.isSuccessful
            }
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }
}

