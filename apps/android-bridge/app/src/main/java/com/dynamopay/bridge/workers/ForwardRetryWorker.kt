package com.dynamopay.bridge.workers

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.dynamopay.bridge.BridgeApp
import com.dynamopay.bridge.CryptoHelper
import com.dynamopay.bridge.EventForwarder

/**
 * WorkManager worker that forwards pending payment-observation events to the backend.
 *
 * Runs with a CONNECTED network constraint so it only attempts delivery when the device has
 * connectivity. On failure, WorkManager retries with exponential backoff, surviving Android
 * process death and app backgrounding. This replaces avoidable periodic 5-second polling with
 * event-triggered + durable retry delivery.
 */
class ForwardRetryWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        val app = applicationContext as? BridgeApp ?: return Result.failure()
        val eventQueue = app.eventQueue
        val cryptoHelper = app.cryptoHelper

        // Reconstruct the forwarder + API client dependencies.
        val securePrefs = getSecurePrefs(applicationContext)
        val apiClient = com.dynamopay.bridge.ApiClient(applicationContext, cryptoHelper, securePrefs)
        val eventForwarder = EventForwarder(applicationContext, cryptoHelper, securePrefs, eventQueue)

        if (!hasConnectivity(applicationContext)) {
            // No network: tell WorkManager to retry later (backoff).
            return Result.retry()
        }

        if (!apiClient.isPaired()) {
            return Result.failure()
        }

        val baseUrl = apiClient.getBaseUrl()
        val deviceId = apiClient.getDeviceId() ?: return Result.failure()
        val signingKey = cryptoHelper.getHmacSecret() ?: return Result.failure()

        try {
            eventForwarder.forwardPendingEvents(baseUrl, deviceId, signingKey)
            return Result.success()
        } catch (e: Exception) {
            e.printStackTrace()
            return Result.retry()
        }
    }

    private fun hasConnectivity(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork
            if (network == null) return false
            val caps = cm.getNetworkCapabilities(network)
            caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        } else {
            cm.activeNetworkInfo?.isConnectedOrConnecting == true
        }
    }

    private fun getSecurePrefs(context: Context): android.content.SharedPreferences {
        val masterKeyAlias = androidx.security.crypto.MasterKeys.getOrCreate(androidx.security.crypto.MasterKeys.AES256_GCM_SPEC)
        return androidx.security.crypto.EncryptedSharedPreferences.create(
            "dynamo_bridge_secure_prefs",
            masterKeyAlias,
            context,
            androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    companion object {
        fun enqueue(context: Context, delaySeconds: Long = 5) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val work = OneTimeWorkRequestBuilder<ForwardRetryWorker>()
                .setConstraints(constraints)
                .setInitialDelay(delaySeconds, java.util.concurrent.TimeUnit.SECONDS)
                .build()
            androidx.work.WorkManager.getInstance(context)
                .enqueueUniqueWork("dynamo_bridge_forward_retry", androidx.work.ExistingWorkPolicy.REPLACE, work)
        }
    }
}
