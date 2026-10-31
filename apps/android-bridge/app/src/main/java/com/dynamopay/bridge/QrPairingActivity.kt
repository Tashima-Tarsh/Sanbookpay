package com.dynamopay.bridge

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONObject

/**
 * Dynamo Bridge QR pairing screen.
 * Accepts a pairing payload string via intent extra (qr_payload) and processes it.
 * ZXing camera scanning can be re-added later with a working dependency.
 */
class QrPairingActivity : AppCompatActivity() {

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

        val qrPayload = intent.getStringExtra("qr_payload")
        if (qrPayload.isNullOrEmpty()) {
            Toast.makeText(this, "No pairing payload provided", Toast.LENGTH_SHORT).show()
            setResult(Activity.RESULT_CANCELED)
            finish()
            return
        }

        val result = apiClient.pairViaQr(qrPayload)
        if (result.paired) {
            Toast.makeText(this, "Device paired successfully!", Toast.LENGTH_LONG).show()
            setResult(Activity.RESULT_OK)
        } else {
            Toast.makeText(this, "Pairing failed: ${result.error}", Toast.LENGTH_LONG).show()
            setResult(Activity.RESULT_CANCELED)
        }
        finish()
    }
}
