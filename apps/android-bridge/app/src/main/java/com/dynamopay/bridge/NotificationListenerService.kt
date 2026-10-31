package com.dynamopay.bridge

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

class NotificationListenerService : NotificationListenerService() {
    private val eventForwarder: EventForwarder by lazy {
        (applicationContext as BridgeApp).eventForwarder
    }
    private val cryptoHelper: CryptoHelper by lazy {
        (applicationContext as BridgeApp).cryptoHelper
    }
    private val securePrefs: EncryptedSharedPreferences by lazy {
        (applicationContext as BridgeApp).securePrefs
    }

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Dynamo Bridge Notification Listener Service created.")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val packageName = sbn.packageName ?: return

        // Only observe notifications from payment/banking apps
        if (!isRelevantPackage(packageName)) return

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val title = extras.getString(android.app.Notification.EXTRA_TITLE)
        val text = extras.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString()
            ?: extras.getCharSequence(android.app.Notification.EXTRA_BIG_TEXT)?.toString()

        // Only process credit notifications
        val combined = "$title $text"
        val creditMatch = java.util.regex.Pattern.compile(
            "(?i)(credited|received|deposit|payment received|upi/cr)"
        )
        if (!creditMatch.matcher(combined).find()) return

        // Extract amount
        val amountPattern = java.util.regex.Pattern.compile("(?i)(?:rs\\.?|inr|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)")
        val amtMatcher = amountPattern.matcher(combined)
        if (!amtMatcher.find()) return

        val rawAmountStr = amtMatcher.group(1)?.replace(",", "") ?: return
        val paise = try {
            val parts = rawAmountStr.split(".")
            val whole = parts[0].toLong()
            val fraction = if (parts.size > 1) parts[1].padEnd(2, '0').take(2).toLong() else 0L
            (whole * 100L) + fraction
        } catch (e: Exception) {
            return
        }

        if (paise <= 0L) return

        // Extract UTR/RRN
        val refPattern = java.util.regex.Pattern.compile(
            "(?i)(?:utr|ref(?:\\s*no)?|txn(?:\\s*id)?|rrn)[\\s:#]+([a-zA-Z0-9\\-_]{6,35})"
        )
        var bankRef: String? = null
        val refMatcher = refPattern.matcher(combined)
        if (refMatcher.find()) bankRef = refMatcher.group(1)?.trim()

        // Extract sender VPA
        val vpaPattern = java.util.regex.Pattern.compile(
            "(?i)(?:from|by)\\s+([a-zA-Z0-9.\\-_]{2,100}@[a-zA-Z0-9.\\-_]{2,64})"
        )
        var senderVpa: String? = null
        val vpaMatcher = vpaPattern.matcher(combined)
        if (vpaMatcher.find()) senderVpa = vpaMatcher.group(1)?.trim()?.trimEnd('.', ',', ';')

        // Extract fingerprint hash for deduplication
        val fingerprint = cryptoHelper.sha256Hex("$packageName:$paise:$bankRef:${sbn.postTime}")

        // Create event and enqueue for forwarding
        val event = QueuedEvent(
            id = java.util.UUID.randomUUID().toString(),
            eventId = "evt_${java.util.UUID.randomUUID().toString()}",
            source = packageName,
            direction = "INBOUND",
            amountPaise = paise,
            currency = "INR",
            referenceUtr = bankRef,
            claimingReceivingIdentity = null,
            notificationTimestamp = null,
            deviceObservedTimestamp = sbn.postTime,
            serverReceivedTimestamp = null,
            parserVersion = "1.0.0",
            eventSignature = null,
            fingerprintHash = fingerprint,
            createdAt = System.currentTimeMillis()
        )

        eventQueue.enqueue(event)

        Log.i(TAG, "Observed credit notification from $packageName: ₹${paise / 100.0} Ref: $bankRef")
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "Dynamo Bridge Notification Listener Service destroyed.")
    }

    private val eventQueue: EventQueue by lazy {
        (applicationContext as BridgeApp).eventQueue
    }

    private fun isRelevantPackage(pkg: String): Boolean {
        val lower = pkg.toLowerCase()
        return lower.contains("upi") || lower.contains("bank") ||
            lower.contains("pay") || lower.contains("phonepe") ||
            lower.contains("gpay") || lower.contains("paytm") ||
            lower.contains("bhim") || lower.contains("hdfc") ||
            lower.contains("icici") || lower.contains("sbi") ||
            lower.contains("axis") || lower.contains("kotak")
    }

    companion object {
        private const val TAG = "DynamoBridgeListener"
    }
}
