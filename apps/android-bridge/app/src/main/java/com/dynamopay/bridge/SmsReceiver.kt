package com.dynamopay.bridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.telephony.SmsMessage
import android.util.Log

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != "android.provider.Telephony.SMS_RECEIVED") return

        val extras = intent.extras ?: return
        val pdus = extras["pdus"] as? Array<*> ?: return

        for (pdu in pdus) {
            val sms = SmsMessage.createFromPdu(pdu as ByteArray)
            val sender = sms.originatingAddress ?: ""
            val body = sms.messageBody ?: ""
            val timestamp = sms.timestampMillis

            Log.d("DynamoBridgeSMS", "SMS from $sender: $body")

            // Only process credit SMS from known banks
            if (!isBankCreditSms(sender, body)) return

            val app = (context as? com.dynamopay.bridge.BridgeApp) ?: return
            val eventQueue = app.eventQueue

            val amountPattern = android.util.Pattern.compile("(?i)(?:rs\\.?|inr|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)")
            val amtMatcher = amountPattern.matcher(body)
            if (!amtMatcher.find()) continue

            val rawAmountStr = amtMatcher.group(1)?.replace(",", "") ?: continue
            val paise = try {
                val parts = rawAmountStr.split(".")
                val whole = parts[0].toLong()
                val fraction = if (parts.size > 1) parts[1].padEnd(2, '0').take(2).toLong() else 0L
                (whole * 100L) + fraction
            } catch (e: Exception) {
                continue
            }

            if (paise <= 0L) continue

            val fingerprint = app.cryptoHelper.sha256Hex("SMS:$sender:$paise:$timestamp")

            val event = QueuedEvent(
                id = java.util.UUID.randomUUID().toString(),
                eventId = "sms_${java.util.UUID.randomUUID().toString()}",
                source = "SMS_GATEWAY",
                direction = "INBOUND",
                amountPaise = paise,
                currency = "INR",
                referenceUtr = null,
                claimingReceivingIdentity = null,
                notificationTimestamp = null,
                deviceObservedTimestamp = timestamp,
                serverReceivedTimestamp = null,
                parserVersion = "1.0.0",
                eventSignature = null,
                fingerprintHash = fingerprint,
                createdAt = System.currentTimeMillis()
            )

            eventQueue.enqueue(event)
        }
    }

    private fun isBankCreditSms(sender: String, body: String): Boolean {
        val lowerSender = sender.lowercase()
        val lowerBody = body.lowercase()
        val isCredit = lowerBody.contains("credited") || lowerBody.contains("received") ||
            lowerBody.contains("deposit") || lowerBody.contains("upi/cr")
        val isBank = lowerSender.contains("hdfc") || lowerSender.contains("icici") ||
            lowerSender.contains("sbi") || lowerSender.contains("axis") ||
            lowerSender.contains("kotak") || lowerSender.contains("baroda") ||
            lowerSender.contains("pnb") || lowerSender.contains("union") ||
            lowerSender.contains("canara") || lowerSender.contains("paytm") ||
            lowerSender.contains("phonepe") || lowerSender.contains("gpay")
        return isCredit && isBank
    }
}
