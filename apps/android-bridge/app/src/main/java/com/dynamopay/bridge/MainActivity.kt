package com.dynamopay.bridge

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import android.os.Handler
import android.os.Looper
import android.widget.*
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

class MainActivity : AppCompatActivity() {
    private lateinit var app: BridgeApp
    private lateinit var cryptoHelper: CryptoHelper
    private lateinit var eventQueue: EventQueue
    private lateinit var eventForwarder: EventForwarder
    private lateinit var apiClient: ApiClient
    private lateinit var healthMonitor: HealthMonitor

    private lateinit var tvStatus: TextView
    private lateinit var tvDeviceId: TextView
    private lateinit var tvEventsQueued: TextView
    private lateinit var btnPair: Button
    private lateinit var btnPermission: Button
    private lateinit var btnSettings: Button
    private lateinit var btnExportLogs: Button
    private lateinit var btnRevoke: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = applicationContext as BridgeApp
        cryptoHelper = app.cryptoHelper
        eventQueue = app.eventQueue
        eventForwarder = app.eventForwarder
        healthMonitor = app.healthMonitor
        apiClient = ApiClient(this, cryptoHelper, getSecurePrefs())

        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }

        val title = TextView(this).apply {
            text = "Dynamo Bridge"
            textSize = 26f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 24)
        }
        layout.addView(title)

        tvStatus = TextView(this).apply {
            text = "Status: Checking..."
            textSize = 18f
            setPadding(0, 12, 0, 24)
        }
        layout.addView(tvStatus)

        tvDeviceId = TextView(this).apply {
            text = "Device ID: -"
            textSize = 14f
            setPadding(0, 0, 0, 24)
        }
        layout.addView(tvDeviceId)

        tvEventsQueued = TextView(this).apply {
            text = "Events queued: 0"
            textSize = 14f
            setPadding(0, 0, 0, 24)
        }
        layout.addView(tvEventsQueued)

        btnPermission = Button(this).apply {
            text = "Grant Notification Access"
            setOnClickListener {
                startActivity(Intent(
                    android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
                ))
            }
        }
        layout.addView(btnPermission)

        btnPair = Button(this).apply {
            text = "Scan Pairing QR"
            setOnClickListener {
                val intent = Intent(this@MainActivity, QrPairingActivity::class.java)
                startActivity(intent)
            }
        }
        layout.addView(btnPair)

        btnSettings = Button(this).apply {
            text = "Device Settings"
            setOnClickListener {
                val intent = Intent(this@MainActivity, DeviceSettingsActivity::class.java)
                startActivity(intent)
            }
        }
        layout.addView(btnSettings)

        btnExportLogs = Button(this).apply {
            text = "Export Logs (Redacted)"
            setOnClickListener {
                exportLogs()
            }
        }
        layout.addView(btnExportLogs)

        btnRevoke = Button(this).apply {
            text = "Revoke Device"
            setVisibility(android.view.View.GONE)
            setOnClickListener {
                revokeDevice()
            }
        }
        layout.addView(btnRevoke)

        val privacyNotice = TextView(this).apply {
            text = "Dynamo Bridge only observes payment credit notifications you explicitly authorize. " +
                "It never collects UPI PINs, passwords, or OTPs."
            textSize = 12f
            setPadding(0, 24, 0, 0)
        }
        layout.addView(privacyNotice)

        setContentView(layout)
        updateStatus()

        if (apiClient.isPaired()) {
            startPeriodicForwarding()
        }
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    private fun updateStatus() {
        val hasPermission = androidx.core.app.NotificationManagerCompat.getEnabledListenerPackages(this)
            .contains(packageName)
        btnPermission.isEnabled = !hasPermission
        btnPermission.text = if (hasPermission) "✓ Notification Access Granted" else "Grant Notification Access"

        if (apiClient.isPaired()) {
            val deviceId = apiClient.getDeviceId() ?: "unknown"
            tvStatus.text = "Status: CONNECTED"
            tvStatus.setTextColor(android.graphics.Color.parseColor("#047857"))
            tvDeviceId.text = "Device ID: $deviceId"
            btnPair.visibility = android.view.View.GONE
            btnRevoke.visibility = android.view.View.VISIBLE
            btnSettings.visibility = android.view.View.VISIBLE
            btnExportLogs.visibility = android.view.View.VISIBLE

            val queueSize = eventQueue.getQueueSize()
            tvEventsQueued.text = "Events queued: $queueSize"

            healthMonitor.reportHealth()
        } else {
            tvStatus.text = "Status: NOT PAIRED"
            tvStatus.setTextColor(android.graphics.Color.parseColor("#b91c1c"))
            tvDeviceId.text = "Device ID: -"
            btnPair.visibility = android.view.View.VISIBLE
            btnRevoke.visibility = android.view.View.GONE
            btnSettings.visibility = android.view.View.GONE
            btnExportLogs.visibility = android.view.View.GONE
            tvEventsQueued.text = "Events queued: 0"
        }
    }

    private fun startPeriodicForwarding() {
        val baseUrl = apiClient.getBaseUrl()
        val deviceId = apiClient.getDeviceId() ?: return
        val signingKey = cryptoHelper.getHmacSecret() ?: return

        val handler = Handler(Looper.getMainLooper())
        handler.post(object : Runnable {
            override fun run() {
                try {
                    eventForwarder.forwardPendingEvents(baseUrl, deviceId, signingKey)
                    val queueSize = eventQueue.getQueueSize()
                    tvEventsQueued.text = "Events queued: $queueSize"
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                handler.postDelayed(this, 5000)
            }
        })
    }

    private fun revokeDevice() {
        val confirmed = android.app.AlertDialog.Builder(this)
            .setTitle("Revoke Device")
            .setMessage("This will unregister this device from Dynamo Bridge. You will need to re-pair to resume observation.")
            .setPositiveButton("Revoke") { _, _ ->
                val success = apiClient.revokeDevice()
                if (success) {
                    Toast.makeText(this@MainActivity, "Device revoked", Toast.LENGTH_SHORT).show()
                    updateStatus()
                } else {
                    Toast.makeText(this@MainActivity, "Revoke failed", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .create()
        confirmed.show()
    }

    private fun exportLogs() {
        val events = eventQueue.getAllEvents()
        val logBuilder = StringBuilder()
        logBuilder.append("Dynamo Bridge Log Export (Redacted)\n")
        logBuilder.append("Generated: ${System.currentTimeMillis()}\n")
        logBuilder.append("Total events: ${events.size}\n\n")

        for (event in events) {
            logBuilder.append("Event ID: ${event.eventId}\n")
            logBuilder.append("Source: ${event.source}\n")
            logBuilder.append("Amount: ${event.amountPaise} ${event.currency}\n")
            logBuilder.append("Reference: ${event.referenceUtr ?: "N/A"}\n")
            logBuilder.append("Timestamp: ${event.deviceObservedTimestamp}\n")
            logBuilder.append("Attempts: ${event.attempts}\n")
            logBuilder.append("---\n")
        }

        val intent = Intent().apply {
            action = Intent.ACTION_SEND
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Dynamo Bridge Log Export")
            putExtra(Intent.EXTRA_TEXT, logBuilder.toString())
        }
        startActivity(Intent.createChooser(intent, "Export Logs"))
    }

    private fun getSecurePrefs(): SharedPreferences {
        val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        return EncryptedSharedPreferences.create(
            "dynamo_bridge_secure_prefs",
            masterKeyAlias,
            this,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }
}

