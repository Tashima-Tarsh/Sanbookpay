package com.dynamopay.bridge

import android.content.Context
import android.os.Handler
import android.os.Looper

data class HealthReport(
    val deviceId: String,
    val isActive: Boolean,
    val listenerStatus: String,
    val lastHeartbeat: Long?,
    val eventsQueued: Int,
    val consecutiveFailures: Int,
    val appVersion: String = "1.0.0"
)

/**
 * Health monitor: reports device health to the backend
 * and tracks listener status and forwarding statistics.
 */
class HealthMonitor(
    private val context: Context,
    private val cryptoHelper: CryptoHelper,
    private val securePrefs: SharedPreferences,
    private val eventForwarder: EventForwarder
) {
    private val handler = Handler(Looper.getMainLooper())
    private var isRunning = false

    fun reportHealth() {
        // Report health asynchronously - the actual backend call happens via EventForwarder
        // This is a placeholder for future health check integration
        val eventsQueued = (context as? BridgeApp)?.eventQueue?.getQueueSize() ?: 0
        val failures = eventForwarder.getConsecutiveFailures()

        android.util.Log.i("DynamoBridgeHealth", "Health report: queued=$eventsQueued failures=$failures")
    }

    fun startPeriodicHealthCheck(intervalMs: Long = 60000) {
        if (isRunning) return
        isRunning = true

        handler.post(object : Runnable {
            override fun run() {
                if (!isRunning) return
                reportHealth()
                handler.postDelayed(this, intervalMs)
            }
        })
    }

    fun stopPeriodicHealthCheck() {
        isRunning = false
        handler.removeCallbacksAndMessages(null)
    }
}
