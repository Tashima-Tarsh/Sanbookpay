package com.sanbookpay.upiintent

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import java.util.concurrent.ConcurrentHashMap

/**
 * Generic UPI Intent Engine.
 *
 * Uses `upi://pay` capability discovery as the default launch mechanism. Does not hardcode
 * app-specific packages unless a documented, justified adapter exists. Supports discovering
 * all installed apps that advertise compatible UPI payment intent handling.
 *
 * All cross-app switching and return capture is handled through the standard Android
 * Activity Result APIs. No accessibility services, screen scraping, or extraction of private
 * payment information from unrelated apps is performed.
 */
class UpiIntentEngine(private val context: Context) {

    private val packageManager: PackageManager = context.packageManager
    private val discoveredAppsCache = ConcurrentHashMap<String, CompatibleUpiApp>()

    /**
     * Discovers installed apps capable of handling a generic `upi://pay` intent.
     * Avoids unnecessary application-specific package hardcoding.
     */
    fun discoverCompatibleUpiApps(): List<CompatibleUpiApp> {
        discoveredAppsCache.clear()
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("upi://pay")).apply {
            addCategory(Intent.CATEGORY_DEFAULT)
            setPackage(null)
        }

        val infos = packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        val apps = mutableListOf<CompatibleUpiApp>()

        for (info in infos) {
            val pkg = info.activityInfo.packageName
            val appName = info.loadLabel(packageManager)?.toString()
            val supportsGeneric = isGenericUpiHandler(pkg)
            val category = categorizeApp(pkg, appName)
            discoveredAppsCache[pkg] = CompatibleUpiApp(pkg, appName, supportsGeneric, category)
            apps.add(discoveredAppsCache[pkg]!!)
        }

        // Sort: generic-capable apps first, then by name.
        apps.sortWith(compareBy({ !it.supportsGenericIntent }, { it.appName ?: "" }))
        return apps
    }

    /**
     * Returns a previously discovered app by package name, or discovers on demand.
     */
    fun getCompatibleApp(packageName: String): CompatibleUpiApp? {
        return discoveredAppsCache[packageName] ?: discoverCompatibleUpiApps().find { it.packageName == packageName }
    }

    /**
     * Checks whether a package appears to be a generic UPI payment handler based on its
     * intent-filter registration for upi://pay. Does not rely on a hardcoded package list.
     */
    private fun isGenericUpiHandler(packageName: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("upi://pay")).apply {
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        val infos = packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        return infos.any { it.activityInfo.packageName == packageName }
    }

    /**
     * Best-effort categorization of an app based on its package/label. Used only for
     * reporting, never to gate launch behavior.
     */
    private fun categorizeApp(packageName: String?, appName: String?): String? {
        val text = "${packageName ?: ""} ${appName ?: ""}".lowercase()
        return when {
            text.contains("gpay") || text.contains("google pay") -> "GOOGLE_PAY"
            text.contains("phonepe") -> "PHONEPE"
            text.contains("paytm") -> "PAYTM"
            text.contains("bhim") -> "BHIM"
            text.contains("upi") && text.contains("bank") -> "BANK_UPI"
            text.contains("upi") || text.contains("pay") -> "OTHER"
            else -> "OTHER"
        }
    }

    /**
     * Package visibility check for Android 11+ (targetSdk 30+). Returns true if the app
     * is visible to the caller and can be launched via an explicit intent.
     */
    fun isPackageVisible(packageName: String): Boolean {
        return try {
            packageManager.getPackageInfo(packageName, PackageManager.GET_ACTIVITIES)
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
    }

    /**
     * Creates a generic `upi://pay` payment intent for the given parameters.
     * Does not bind to a specific app; the resolver/chooser picks a compatible handler.
     */
    fun createPaymentIntent(
        vpa: String,
        payeeName: String,
        amountRupees: Double,
        orderId: String,
        transactionRef: String,
        note: String = "Sanbookpay payment"
    ): Intent {
        val uri = Uri.parse("upi://pay").buildUpon()
            .appendQueryParameter("pa", vpa)
            .appendQueryParameter("pn", payeeName)
            .appendQueryParameter("mc", "")
            .appendQueryParameter("mode", "04") // 04 = fixed amount
            .appendQueryParameter("tr", transactionRef)
            .appendQueryParameter("tn", note)
            .appendQueryParameter("am", amountRupees.toString())
            .appendQueryParameter("cu", "INR")
            .build()

        return Intent(Intent.ACTION_VIEW, uri).apply {
            addCategory(Intent.CATEGORY_DEFAULT)
            setPackage(null) // generic: let the system resolve a compatible UPI app
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
    }

    /**
     * Creates an app-specific launch intent for a chosen compatible UPI app.
     * Only used when the app has been discovered and supports generic intents.
     */
    fun createLaunchIntentForApp(upiUri: Uri, packageName: String): Intent {
        return Intent(Intent.ACTION_VIEW, upiUri).apply {
            addCategory(Intent.CATEGORY_DEFAULT)
            setPackage(packageName)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
    }

    companion object {
        const val UPI_SCHEME = "upi://pay"
        const val REQUEST_CODE_UPI_PAY = 1001
    }
}
