package com.dynamopay.bridge

import android.widget.Toast
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import com.google.zxing.Result
import com.journeyapps.barcodescanner.CaptureActivity
import org.json.JSONObject

/**
 * Dynamo Bridge QR pairing screen.
 * Uses the ZXing Android Embedded built-in CaptureActivity camera scanner.
 */
class QrPairingActivity : CaptureActivity() {

    private lateinit var apiClient: ApiClient
    private lateinit var cryptoHelper: CryptoHelper

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)

        val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        val securePrefs = EncryptedSharedPreferences.create(
            "dynamo_bridge_secure_prefs",
            masterKeyAlias,
            this,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        cryptoHelper = CryptoHelper(this, securePrefs)
        apiClient = ApiClient(this, cryptoHelper, securePrefs)
    }

    override fun handleResult(rawResult: Result?) {
        if (rawResult == null) {
            Toast.makeText(this, "No QR code detected", Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        handleQrResult(rawResult.text)
    }

    private fun handleQrResult(qrText: String?) {
        if (qrText.isNullOrEmpty()) {
            Toast.makeText(this, "Invalid QR code", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        try {
            val json = JSONObject(qrText)
            if (json.optString("type", "") != "dynamo-bridge-pairing") {
                Toast.makeText(this, "Not a Dynamo Bridge pairing QR", Toast.LENGTH_SHORT).show()
                finish()
                return
            }

            val result = apiClient.pairViaQr(qrText)
            if (result.paired) {
                Toast.makeText(this, "Device paired successfully!", Toast.LENGTH_LONG).show()
                setResult(RESULT_OK)
            } else {
                Toast.makeText(this, "Pairing failed: ${result.error}", Toast.LENGTH_LONG).show()
            }
        } catch (e: Exception) {
            e.printStackTrace()
            Toast.makeText(this, "Invalid QR code format", Toast.LENGTH_SHORT).show()
        }
        finish()
    }
}
