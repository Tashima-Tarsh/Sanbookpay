package com.sanbookpay.upiintent

/**
 * Optional app-specific UPI intent adapter.
 *
 * Adapters are used ONLY where a UPI app's official documentation describes a supported,
 * non-generic intent contract that the generic `upi://pay` mechanism cannot satisfy. The
 * default engine uses generic `upi://pay` discovery for all compatible installed apps.
 *
 * Do NOT use accessibility services, screen scraping, or extract private payment information
 * from unrelated applications.
 */
interface UpiIntentAdapter {
    /** The package name this adapter handles. */
    val packageName: String

    /** Whether this adapter is applicable to the installed app version. */
    fun isApplicable(packageName: String, versionName: String?): Boolean

    /** Build an app-specific launch intent from a generic UPI URI, or null to fall back to generic. */
    fun buildLaunchIntent(upiUri: android.net.Uri): android.content.Intent?

    /** Parse an app-specific response intent into a normalized status, or null to use the generic parser. */
    fun parseResponse(intent: android.content.Intent?): UpiStatus?
}
