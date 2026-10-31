package com.dynamopay.bridge

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.security.crypto.EncryptedSharedPreferences
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.util.*
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Cryptographic helper for Dynamo Bridge.
 * - Device-bound ECDSA P-256 key pair in Android Keystore
 * - HMAC-SHA256 signing for event transport
 * - AES-256-GCM encryption for local event queue
 */
class CryptoHelper(
    private val context: Context,
    private val securePrefs: EncryptedSharedPreferences
) {
    private val KEY_ALIAS = "dynamo_bridge_device_key"
    private val PREFS_DEVICE_KEY_PAIR_GENERATED = "device_keypair_generated"
    private val PREFS_PUBLIC_KEY_PEM = "device_public_key_pem"
    private val PREFS_DEVICE_FINGERPRINT = "device_fingerprint"
    private val PREFS_HMAC_SECRET = "device_hmac_secret"

    fun ensureDeviceKeyPair(): Boolean {
        if (securePrefs.getBoolean(PREFS_DEVICE_KEY_PAIR_GENERATED, false)) return true
        return try {
            val generator = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore"
            )
            val spec = KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN
            ).setDigests(KeyProperties.DIGEST_SHA256)
             .build()
            generator.initialize(spec)
            val keyPair = generator.generateKeyPair()
            val publicKey = keyPair.public
            val publicKeyPem = publicKeyToPem(publicKey)
            val fingerprint = sha256Hex(publicKeyPem)

            val hmacSecret = ByteArray(32)
            Random().nextBytes(hmacSecret)
            val hmacSecretBase64 = Base64.getEncoder().encodeToString(hmacSecret)

            securePrefs.edit()
                .putBoolean(PREFS_DEVICE_KEY_PAIR_GENERATED, true)
                .putString(PREFS_PUBLIC_KEY_PEM, publicKeyPem)
                .putString(PREFS_DEVICE_FINGERPRINT, fingerprint)
                .putString(PREFS_HMAC_SECRET, hmacSecretBase64)
                .apply()

            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun getPublicKeyPem(): String? {
        return securePrefs.getString(PREFS_PUBLIC_KEY_PEM, null)
    }

    fun getDeviceFingerprint(): String? {
        return securePrefs.getString(PREFS_DEVICE_FINGERPRINT, null)
    }

    fun getHmacSecret(): String? {
        return securePrefs.getString(PREFS_HMAC_SECRET, null)
    }

    fun signData(data: ByteArray): ByteArray? {
        return try {
            val ks = KeyStore.getInstance("AndroidKeyStore")
            ks.load(null)
            val entry = ks.getEntry(KEY_ALIAS, null) as KeyStore.PrivateKeyEntry
            val signature = Signature.getInstance("SHA256withECDSA")
            signature.initSign(entry.privateKey)
            signature.update(data)
            signature.sign()
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun signDataBase64(data: String): String? {
        val sig = signData(data.toByteArray(Charsets.UTF_8))
        return sig?.let { Base64.getEncoder().encodeToString(it) }
    }

    fun hmacSha256(data: String, key: String?): String? {
        if (key == null) return null
        return try {
            val secret = SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256")
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(secret)
            mac.doFinal(data.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun encryptForQueue(plaintext: String): String? {
        val hmacSecret = getHmacSecret() ?: return null
        val keyBytes = sha256Bytes(hmacSecret)
        return try {
            val iv = ByteArray(12)
            Random().nextBytes(iv)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val spec = GCMParameterSpec(128, iv)
            val secretKey = SecretKeySpec(keyBytes, "AES")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, spec)
            val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
            Base64.getEncoder().encodeToString(iv + ciphertext)
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun decryptFromQueue(ciphertextB64: String): String? {
        val hmacSecret = getHmacSecret() ?: return null
        val keyBytes = sha256Bytes(hmacSecret)
        return try {
            val combined = Base64.getDecoder().decode(ciphertextB64)
            val iv = Arrays.copyOfRange(combined, 0, 12)
            val actualCiphertext = Arrays.copyOfRange(combined, 12, combined.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val spec = GCMParameterSpec(128, iv)
            val secretKey = SecretKeySpec(keyBytes, "AES")
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
            val plaintext = cipher.doFinal(actualCiphertext)
            String(plaintext, Charsets.UTF_8)
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun sha256Hex(input: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val hash = md.digest(input.toByteArray(Charsets.UTF_8))
        return hash.joinToString("") { "%02x".format(it) }
    }

    fun sha256Bytes(input: String): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(input.toByteArray(Charsets.UTF_8))
    }

    private fun publicKeyToPem(publicKey: java.security.PublicKey): String {
        val encoded = publicKey.encoded
        val b64 = Base64.getEncoder().encodeToString(encoded)
        val sb = StringBuilder()
        sb.append("-----BEGIN PUBLIC KEY-----\n")
        for (i in 0 until b64.length step 64) {
            sb.append(b64.substring(i, minOf(i + 64, b64.length)))
            sb.append("\n")
        }
        sb.append("-----END PUBLIC KEY-----\n")
        return sb.toString()
    }
}
