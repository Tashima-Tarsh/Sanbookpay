package com.dynamopay.bridge

import android.app.Application
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

class BridgeApp : Application() {
    lateinit var cryptoHelper: CryptoHelper
    lateinit var eventQueue: EventQueue
    lateinit var eventForwarder: EventForwarder
    lateinit var healthMonitor: HealthMonitor

    override fun onCreate() {
        super.onCreate()

        val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        val securePrefs = EncryptedSharedPreferences.create(
            "dynamo_bridge_secure_prefs",
            masterKeyAlias,
            applicationContext,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )

        cryptoHelper = CryptoHelper(applicationContext, securePrefs)
        eventQueue = EventQueue(applicationContext, cryptoHelper, securePrefs)
        eventForwarder = EventForwarder(applicationContext, cryptoHelper, securePrefs, eventQueue)
        healthMonitor = HealthMonitor(applicationContext, cryptoHelper, securePrefs, eventForwarder)
    }
}
