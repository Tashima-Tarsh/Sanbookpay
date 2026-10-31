package com.dynamopay.bridge

import android.content.SharedPreferences
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import android.widget.*
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

class DeviceSettingsActivity : AppCompatActivity() {
    private lateinit var apiClient: ApiClient
    private lateinit var cryptoHelper: CryptoHelper

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        val securePrefs: SharedPreferences = EncryptedSharedPreferences.create(
            "dynamo_bridge_secure_prefs",
            masterKeyAlias,
            this,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        cryptoHelper = CryptoHelper(this, securePrefs)
        apiClient = ApiClient(this, cryptoHelper, securePrefs)

        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }

        val title = TextView(this).apply {
            text = "Device Settings"
            textSize = 22f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 24)
        }
        layout.addView(title)

        val tvDeviceId = TextView(this).apply {
            text = "Device ID: ${apiClient.getDeviceId() ?: "unknown"}"
            textSize = 16f
            setPadding(0, 0, 0, 16)
        }
        layout.addView(tvDeviceId)

        val tvMerchantId = TextView(this).apply {
            text = "Merchant ID: ${apiClient.getMerchantId() ?: "unknown"}"
            textSize = 16f
            setPadding(0, 0, 0, 16)
        }
        layout.addView(tvMerchantId)

        val tvBaseUrl = TextView(this).apply {
            text = "Gateway URL: ${apiClient.getBaseUrl()}"
            textSize = 14f
            setPadding(0, 0, 0, 24)
        }
        layout.addView(tvBaseUrl)

        val tvPublicKey = TextView(this).apply {
            text = "Public Key: ${cryptoHelper.getPublicKeyPem()?.take(40) ?: "N/A"}..."
            textSize = 12f
            setPadding(0, 0, 0, 24)
        }
        layout.addView(tvPublicKey)

        val btnSync = Button(this).apply {
            text = "Sync Subscription Status"
            setOnClickListener {
                val status = apiClient.syncSubscriptionStatus()
                Toast.makeText(this@DeviceSettingsActivity, "Subscription: $status", Toast.LENGTH_SHORT).show()
            }
        }
        layout.addView(btnSync)

        val btnHeartbeat = Button(this).apply {
            text = "Send Heartbeat"
            setOnClickListener {
                val success = apiClient.sendHeartbeat()
                Toast.makeText(this@DeviceSettingsActivity, if (success) "Heartbeat sent" else "Heartbeat failed", Toast.LENGTH_SHORT).show()
            }
        }
        layout.addView(btnHeartbeat)

        val btnBack = Button(this).apply {
            text = "Back"
            setOnClickListener { finish() }
        }
        layout.addView(btnBack)

        setContentView(layout)
    }
}

