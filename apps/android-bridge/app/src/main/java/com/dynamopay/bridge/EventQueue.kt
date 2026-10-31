package com.dynamopay.bridge

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

const val PREFS_EVENT_QUEUE = "event_queue"
const val PREFS_QUEUE_VERSION = "queue_version"
const val QUEUE_FORMAT_VERSION = 1

data class QueuedEvent(
    val id: String,
    val eventId: String,
    val source: String,
    val direction: String,
    val amountPaise: Long,
    val currency: String,
    val referenceUtr: String?,
    val claimingReceivingIdentity: String?,
    val notificationTimestamp: Long?,
    val deviceObservedTimestamp: Long,
    val serverReceivedTimestamp: Long?,
    val parserVersion: String?,
    val eventSignature: String?,
    val fingerprintHash: String,
    val createdAt: Long,
    val attempts: Int = 0
)

/**
 * Local encrypted event queue for offline persistence.
 * Events are encrypted at rest and persisted until successfully forwarded.
 */
class EventQueue(
    private val context: Context,
    private val cryptoHelper: CryptoHelper,
    private val securePrefs: SharedPreferences
) {
    private val MAX_QUEUE_SIZE = 10000
    private val MAX_EVENT_AGE_HOURS = 168 // 7 days

    fun enqueue(event: QueuedEvent): Boolean {
        return try {
            val existing = getAllEvents()
            if (existing.size >= MAX_QUEUE_SIZE) {
                val sorted = existing.sortedBy { it.createdAt }
                val toRemove = sorted.take(existing.size - MAX_QUEUE_SIZE + 1)
                for (e in toRemove) removeEvent(e.id)
            }

            val encrypted = cryptoHelper.encryptForQueue(eventToJson(event).toString()) ?: return false
            securePrefs.edit()
                .putString("${PREFS_EVENT_QUEUE}.${event.id}", encrypted)
                .apply()
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun getAllEvents(): List<QueuedEvent> {
        val events = mutableListOf<QueuedEvent>()
        val all = securePrefs.all
        for ((key, value) in all) {
            if (key.startsWith("${PREFS_EVENT_QUEUE}.")) {
                val encrypted = value as? String ?: continue
                val decrypted = cryptoHelper.decryptFromQueue(encrypted) ?: continue
                try {
                    val json = JSONObject(decrypted)
                    events.add(jsonToEvent(json))
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
        return events.sortedBy { it.createdAt }
    }

    fun getPendingEvents(limit: Int = 100): List<QueuedEvent> {
        return getAllEvents().take(limit)
    }

    fun removeEvent(eventId: String) {
        securePrefs.edit().remove("${PREFS_EVENT_QUEUE}.$eventId").apply()
    }

    fun incrementAttempts(eventId: String) {
        val events = getAllEvents()
        val event = events.find { it.id == eventId } ?: return
        val updated = event.copy(attempts = event.attempts + 1)
        removeEvent(eventId)
        enqueue(updated)
    }

    fun getQueueSize(): Int {
        return getAllEvents().size
    }

    fun cleanupOldEvents() {
        val cutoff = System.currentTimeMillis() - (MAX_EVENT_AGE_HOURS * 60 * 60 * 1000)
        val events = getAllEvents()
        for (event in events) {
            if (event.createdAt < cutoff) {
                removeEvent(event.id)
            }
        }
    }

    private fun eventToJson(event: QueuedEvent): JSONObject {
        return JSONObject().apply {
            put("id", event.id)
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
            put("createdAt", event.createdAt)
            put("attempts", event.attempts)
        }
    }

    private fun jsonToEvent(json: JSONObject): QueuedEvent {
        return QueuedEvent(
            id = json.getString("id"),
            eventId = json.getString("eventId"),
            source = json.getString("source"),
            direction = json.optString("direction", "INBOUND"),
            amountPaise = json.getLong("amountPaise"),
            currency = json.optString("currency", "INR"),
            referenceUtr = json.optString("referenceUtr", null),
            claimingReceivingIdentity = json.optString("claimingReceivingIdentity", null),
            notificationTimestamp = json.optLong("notificationTimestamp", -1).takeIf { it >= 0 },
            deviceObservedTimestamp = json.getLong("deviceObservedTimestamp"),
            serverReceivedTimestamp = json.optLong("serverReceivedTimestamp", -1).takeIf { it >= 0 },
            parserVersion = json.optString("parserVersion", null),
            eventSignature = json.optString("eventSignature", null),
            fingerprintHash = json.getString("fingerprintHash"),
            createdAt = json.getLong("createdAt"),
            attempts = json.optInt("attempts", 0)
        )
    }
}

