package com.dynamopay.bridge

import android.os.Bundle
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import com.google.zxing.Result
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import org.json.JSONObject
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

class QrPairingActivity : AppCompatActivity() {
    private lateinit var apiClient: ApiClient
    private lateinit var cryptoHelper: CryptoHelper

    override fun onCreate(savedInstanceState: Bundle?) {
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

        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }

        val title = TextView(this).apply {
            text = "Dynamo Bridge - Pair Device"
            textSize = 22f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 24)
        }
        layout.addView(title)

        val desc = TextView(this).apply {
            text = "Scan the pairing QR code shown in your merchant dashboard."
            textSize = 16f
            setPadding(0, 0, 0, 24)
        }
        layout.addView(desc)

        val scannerView = DecoratedBarcodeView(this)
        layout.addView(scannerView)

        setContentView(layout)

        scannerView.decodeContinuous(callback = object : BarcodeCallback {
            override fun decodeResult(result: Result?) {
                if (result != null) {
                    handleQrResult(result.text)
                    scannerView.pause()
                }
            }

            override fun possibleResultPoints(p: List<com.google.zxing.ResultPoint>?) {}
        })
    }

    private fun handleQrResult(qrText: String?) {
        if (qrText == null || qrText.isEmpty()) {
            Toast.makeText(this, "Invalid QR code", Toast.LENGTH_SHORT).show()
            return
        }

        try {
            val json = JSONObject(qrText)
            val type = json.optString("type", "")
            if (type != "dynamo-bridge-pairing") {
                Toast.makeText(this, "Not a Dynamo Bridge pairing QR", Toast.LENGTH_SHORT).show()
                return
            }

            val result = apiClient.pairViaQr(qrText)
            if (result.paired) {
                Toast.makeText(this, "Device paired successfully!", Toast.LENGTH_LONG).show()
                setResult(RESULT_OK)
                finish()
            } else {
                Toast.makeText(this, "Pairing failed: ${result.error}", Toast.LENGTH_LONG).show()
            }
        } catch (e: Exception) {
            e.printStackTrace()
            Toast.makeText(this, "Invalid QR code format", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onPause() {
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
    }
}
