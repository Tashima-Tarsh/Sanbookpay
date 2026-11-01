package com.sanbookpay.upiintent

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import org.json.JSONObject

/**
 * Transmits buyer-reported UPI payment returns to Sanbookpay and fetches server payment status.
 *
 * Behavior:
 *   - Attempts immediate event transmission on return; never deliberately waits for the
 *     observer's five-second cycle.
 *   - On network interruption, schedules WorkManager-based reliable retry with exponential
 *     backoff.
 *   - Retry and session recovery after process death / app backgrounding / force-close.
 */
class ReturnTransmitter(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .writeTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Submits a buyer-reported payment return to the server.
     *
     * @param paymentReturn the parsed buyer-returned payment info (REPORTED evidence level).
     * @param pendingPayment the local pending payment record (for recovery/retry).
     * @param callback invoked on the main thread with the submission result.
     */
    fun submit(
        paymentReturn: UpiPaymentReturn,
        pendingPayment: PendingPayment,
        callback: (UpiSubmitResult) -> Unit
    ) {
        val baseUrl = pendingPayment.metadata["serverBaseUrl"] ?: "http://127.0.0.1:6100"
        val url = "$baseUrl/api/v1/payments/${paymentReturn.paymentId}/client-return"

        val body = JSONObject().apply {
            put("idempotencyKey", paymentReturn.idempotencyKey)
            put("sourcePlatform", paymentReturn.sourcePlatform ?: JSONObject.NULL)
            put("appIdentity", paymentReturn.appIdentity ?: JSONObject.NULL)
            put("rawResult", paymentReturn.rawResult ?: JSONObject.NULL)
            put("parsedStatus", paymentReturn.parsedStatus)
            put("upiTransactionReference", paymentReturn.upiTransactionReference ?: JSONObject.NULL)
            put("eventTimestamp", paymentReturn.eventTimestamp)
            put("attemptId", paymentReturn.attemptId)
            put("metadata", JSONObject(paymentReturn.metadata))
        }

        val request = Request.Builder()
            .url(url)
            .addHeader("Content-Type", "application/json")
            .addHeader("Idempotency-Key", paymentReturn.idempotencyKey)
            .post(RequestBody.create(body.toString(), toMediaType("application/json")))
            .build()

        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                // Network interruption: schedule WorkManager retry, do NOT fail the UX.
                scheduleRetry(pendingPayment, paymentReturn)
                mainHandler.post {
                    callback(UpiSubmitResult.Failure(e))
                }
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                val code = response.code
                val body = response.body?.string() ?: "{}"
                response.close()

                if (code == 200 || code == 201) {
                    val serverStatus = try {
                        JSONObject(body).optString("status", "accepted")
                    } catch (e: Exception) {
                        "accepted"
                    }
                    val eventId = try {
                        JSONObject(body).optString("eventId", null)
                    } catch (e: Exception) {
                        null
                    }
                    mainHandler.post {
                        callback(UpiSubmitResult.Accepted(serverStatus, eventId))
                    }
                } else if (code == 409) {
                    // Duplicate idempotency key -> already recorded.
                    val existingEventId = try { JSONObject(body).optString("eventId", null) } catch (e: Exception) { null }
                    mainHandler.post {
                        callback(UpiSubmitResult.Duplicate(existingEventId ?: paymentReturn.idempotencyKey))
                    }
                } else {
                    mainHandler.post {
                        callback(UpiSubmitResult.Failure(java.io.IOException("HTTP $code")))
                    }
                }
            }
        })
    }

    /**
     * Fetches the authoritative server payment status for reconciliation.
     */
    fun fetchStatus(paymentId: String, callback: (ServerPaymentStatus?) -> Unit) {
        val baseUrl = "http://127.0.0.1:6100"
        val url = "$baseUrl/api/v1/payments/$paymentId/status"

        val request = Request.Builder().url(url).get().build()

        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                mainHandler.post { callback(null) }
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                val code = response.code
                val body = response.body?.string() ?: "{}"
                response.close()
                if (code == 200) {
                    val status = try {
                        val o = JSONObject(body)
                        ServerPaymentStatus(
                            paymentId = o.optString("paymentId", paymentId),
                            orderId = o.optString("orderId", ""),
                            attemptId = o.optString("attemptId", null).takeIf { it.isNotEmpty() },
                            status = o.optString("status", "UNKNOWN"),
                            amountPaise = o.optLong("amountPaise", -1).takeIf { it >= 0 },
                            currency = o.optString("currency", null).takeIf { it.isNotEmpty() },
                            verificationLevel = o.optInt("verificationLevel", -1).takeIf { it >= 0 },
                            verified = o.optBoolean("verified", false)
                        )
                    } catch (e: Exception) {
                        null
                    }
                    mainHandler.post { callback(status) }
                } else {
                    mainHandler.post { callback(null) }
                }
            }
        })
    }

    /**
     * Schedules a WorkManager one-time retry with exponential backoff based on retryCount.
     * WorkManager guarantees execution even after process death.
     */
    fun scheduleRetry(pendingPayment: PendingPayment, paymentReturn: UpiPaymentReturn) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val backoffDelayMs = minOf(1000L * (1 shl (pendingPayment.retryCount + 1)), 60_000L)

        val inputData = Data.Builder()
            .putString("payment_id", pendingPayment.paymentId)
            .putString("idempotency_key", paymentReturn.idempotencyKey)
            .putString("return_json", buildReturnJson(paymentReturn).toString())
            .build()

        val workRequest = OneTimeWorkRequestBuilder<UpiRetryWorker>()
            .setInputData(inputData)
            .setInitialDelay(backoffDelayMs, java.util.concurrent.TimeUnit.MILLISECONDS)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context)
            .enqueueUniqueWork(
                "upi_retry_${pendingPayment.paymentId}",
                ExistingWorkPolicy.REPLACE,
                workRequest
            )
    }

    private fun buildReturnJson(paymentReturn: UpiPaymentReturn): String {
        return JSONObject().apply {
            put("returnId", paymentReturn.returnId)
            put("attemptId", paymentReturn.attemptId)
            put("paymentId", paymentReturn.paymentId)
            put("correlationId", paymentReturn.correlationId ?: JSONObject.NULL)
            put("sourcePlatform", paymentReturn.sourcePlatform ?: JSONObject.NULL)
            put("appIdentity", paymentReturn.appIdentity ?: JSONObject.NULL)
            put("rawResult", paymentReturn.rawResult ?: JSONObject.NULL)
            put("parsedStatus", paymentReturn.parsedStatus)
            put("upiTransactionReference", paymentReturn.upiTransactionReference ?: JSONObject.NULL)
            put("eventTimestamp", paymentReturn.eventTimestamp)
            put("idempotencyKey", paymentReturn.idempotencyKey)
            put("metadata", JSONObject(paymentReturn.metadata))
        }.toString()
    }

    companion object {
        private const val KEY_PAYMENT_ID = "payment_id"
        private const val KEY_IDEMPOTENCY_KEY = "idempotency_key"
        private const val KEY_RETURN_JSON = "return_json"
    }
}

/**
 * WorkManager worker that retries submitting a pending payment return when the device
 * regains connectivity. Survives process death and app backgrounding.
 */
class UpiRetryWorker(
    context: Context,
    workerParams: WorkerParameters
) : Worker(context, workerParams) {

    override fun doWork(): Result {
        val paymentId = inputData.getString(ReturnTransmitter.KEY_PAYMENT_ID) ?: return Result.failure()
        val idempotencyKey = inputData.getString(ReturnTransmitter.KEY_IDEMPOTENCY_KEY) ?: return Result.failure()
        val returnJson = inputData.getString(ReturnTransmitter.KEY_RETURN_JSON) ?: return Result.failure()

        val store = PendingPaymentStore(applicationContext)
        val pendingPayment = store.load(paymentId) ?: return Result.success()

        val paymentReturn = try {
            val o = JSONObject(returnJson)
            UpiPaymentReturn(
                returnId = o.optString("returnId", "ret_worker_$paymentId"),
                attemptId = o.getString("attemptId"),
                paymentId = o.getString("paymentId"),
                correlationId = o.optString("correlationId", null).takeIf { it.isNotEmpty() },
                sourcePlatform = o.optString("sourcePlatform", null).takeIf { it.isNotEmpty() },
                appIdentity = o.optString("appIdentity", null).takeIf { it.isNotEmpty() },
                rawResult = o.optString("rawResult", null).takeIf { it.isNotEmpty() },
                parsedStatus = o.optString("parsedStatus", "UNKNOWN"),
                upiTransactionReference = o.optString("upiTransactionReference", null).takeIf { it.isNotEmpty() },
                eventTimestamp = o.optLong("eventTimestamp", System.currentTimeMillis()),
                idempotencyKey = idempotencyKey,
                metadata = o.optJSONObject("metadata")?.toMap() ?: emptyMap()
            )
        } catch (e: Exception) {
            return Result.failure()
        }

        val transmitter = ReturnTransmitter(applicationContext)
        val latch = java.util.concurrent.CountDownLatch(1)
        var submitted = false
        transmitter.submit(paymentReturn, pendingPayment) { result ->
            when (result) {
                is UpiSubmitResult.Accepted, is UpiSubmitResult.Duplicate -> {
                    submitted = true
                    store.markSubmitted(paymentId)
                }
                is UpiSubmitResult.Failure -> submitted = false
            }
            latch.countDown()
        }
        latch.await()

        return if (submitted) Result.success() else Result.retry()
    }
}
