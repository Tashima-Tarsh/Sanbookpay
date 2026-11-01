package com.sanbookpay.upiintent

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Public entry point for the Sanbookpay Universal UPI Intent SDK.
 *
 * The SDK is buyer-side only. It launches a compatible installed UPI app, captures the
 * buyer-returned result, and submits it to Sanbookpay as buyer-reported payment information
 * (not bank-confirmed settlement).
 *
 * Required interfaces:
 *   createPaymentIntent()
 *   discoverCompatibleUpiApps()
 *   launchPayment()
 *   capturePaymentReturn()
 *   parseUpiResponse()
 *   normalizeReportedStatus()
 *   submitReturnToServer()
 *   resumePendingPayment()
 *   getServerPaymentStatus()
 */
class UpiIntentSdk private constructor(
    private val context: Context,
    private val engine: UpiIntentEngine,
    private val store: PendingPaymentStore,
    private val transmitter: ReturnTransmitter,
    private val mainHandler: Handler
) {

    private val pendingReturns = ConcurrentHashMap<String, UpiPaymentReturn>()

    private constructor(context: Context) : this(
        context,
        UpiIntentEngine(context.applicationContext),
        PendingPaymentStore(context.applicationContext),
        ReturnTransmitter(context.applicationContext),
        Handler(Looper.getMainLooper())
    )

    /**
     * Obtain the SDK instance bound to an Android Application (recommended) or Context.
     */
    fun init(application: Application): UpiIntentSdk {
        return UpiIntentSdk(application.applicationContext)
    }

    // ------------------------------------------------------------------
    // createPaymentIntent()
    // ------------------------------------------------------------------
    /**
     * Builds a generic `upi://pay` payment intent (not bound to a specific app).
     * The caller decides which compatible app to launch via launchPayment().
     */
    fun createPaymentIntent(
        vpa: String,
        payeeName: String,
        amountRupees: Double,
        orderId: String,
        transactionRef: String,
        note: String = "Sanbookpay payment"
    ): Intent {
        return engine.createPaymentIntent(vpa, payeeName, amountRupees, orderId, transactionRef, note)
    }

    // ------------------------------------------------------------------
    // discoverCompatibleUpiApps()
    // ------------------------------------------------------------------
    /**
     * Discovers installed apps capable of handling a generic `upi://pay` intent.
     * Results are cached; call again to refresh.
     */
    fun discoverCompatibleUpiApps(): List<CompatibleUpiApp> {
        return engine.discoverCompatibleUpiApps()
    }

    // ------------------------------------------------------------------
    // launchPayment()
    // ------------------------------------------------------------------
    /**
     * Launches the UPI payment in a compatible app.
     *
     * @param activity the calling Activity (used to register the Activity Result contract).
     * @param intent the payment intent (from createPaymentIntent or createLaunchIntentForApp).
     * @param pendingPayment the locally stored pending payment (will be encrypted & persisted).
     * @param callback invoked with the launch result.
     */
    fun launchPayment(
        activity: Activity,
        intent: Intent,
        pendingPayment: PendingPayment,
        callback: (UpiLaunchResult) -> Unit
    ) {
        // Persist the pending payment BEFORE switching apps so we survive process death.
        store.save(pendingPayment)

        // Register the Activity Result contract to capture the return from the external app.
        val resultLauncher = activity.registerForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
        ) { result ->
            onPaymentResult(result, pendingPayment, callback)
        }

        try {
            resultLauncher.launch(intent)
            callback(UpiLaunchResult.IntentLaunched)
        } catch (e: Exception) {
            callback(UpiLaunchResult.LaunchFailure(e))
        }
    }

    /**
     * Launches payment in a specific discovered compatible app by package name.
     */
    fun launchPaymentInApp(
        activity: Activity,
        packageName: String,
        upiUri: Uri,
        pendingPayment: PendingPayment,
        callback: (UpiLaunchResult) -> Unit
    ) {
        val app = engine.getCompatibleApp(packageName) ?: run {
            callback(UpiLaunchResult.NoCompatibleApp(packageName))
            return
        }
        if (!app.supportsGenericIntent) {
            // App-specific adapter only where documented & justified; otherwise fall back to generic.
            callback(UpiLaunchResult.NoCompatibleApp(packageName))
            return
        }
        val launchIntent = engine.createLaunchIntentForApp(upiUri, packageName)
        launchPayment(activity, launchIntent, pendingPayment, callback)
    }

    private fun onPaymentResult(
        result: androidx.activity.result.ActivityResult?,
        pendingPayment: PendingPayment,
        callback: (UpiLaunchResult) -> Unit
    ) {
        if (result == null) {
            callback(UpiLaunchResult.LaunchFailure(IllegalStateException("Null result from UPI app")))
            return
        }

        val captureResult = capturePaymentReturn(result.intent, pendingPayment)
        when (captureResult) {
            is UpiCaptureResult.Returned -> {
                val paymentReturn = captureResult.paymentReturn
                // De-duplicate returns in-memory before submitting.
                if (pendingReturns.putIfAbsent(paymentReturn.idempotencyKey, paymentReturn) != null) {
                    callback(UpiLaunchResult.IntentLaunched) // duplicate suppressed locally
                    return
                }
                // Attempt immediate transmission; never wait for an observer cycle.
                submitReturnToServer(paymentReturn, pendingPayment) { submitResult ->
                    when (submitResult) {
                        is UpiSubmitResult.Accepted -> {
                            store.markSubmitted(pendingPayment.paymentId)
                            callback(UpiLaunchResult.IntentLaunched)
                        }
                        is UpiSubmitResult.Duplicate -> {
                            store.markSubmitted(pendingPayment.paymentId)
                            callback(UpiLaunchResult.IntentLaunched)
                        }
                        is UpiSubmitResult.Failure -> {
                            // Network interruption: WorkManager will retry. Keep pending payment.
                            store.incrementRetry(pendingPayment.paymentId)
                            callback(UpiLaunchResult.IntentLaunched)
                        }
                    }
                }
            }
            is UpiCaptureResult.NoReturn -> {
                // Null / no data returned: treat as cancelled.
                val cancelledReturn = UpiPaymentReturn(
                    returnId = "ret_${System.currentTimeMillis()}",
                    attemptId = pendingPayment.attemptId,
                    paymentId = pendingPayment.paymentId,
                    correlationId = pendingPayment.correlationId,
                    sourcePlatform = "ANDROID",
                    appIdentity = null,
                    rawResult = null,
                    parsedStatus = "CANCELLED",
                    upiTransactionReference = null,
                    eventTimestamp = System.currentTimeMillis(),
                    idempotencyKey = pendingPayment.idempotencyKey,
                    metadata = mapOf("orderId" to pendingPayment.orderId, "amountPaise" to pendingPayment.amountPaise.toString())
                )
                submitReturnToServer(cancelledReturn, pendingPayment) { callback(UpiLaunchResult.IntentLaunched) }
            }
            is UpiCaptureResult.InvalidFormat -> {
                val unsupportedReturn = UpiPaymentReturn(
                    returnId = "ret_${System.currentTimeMillis()}",
                    attemptId = pendingPayment.attemptId,
                    paymentId = pendingPayment.paymentId,
                    correlationId = pendingPayment.correlationId,
                    sourcePlatform = "ANDROID",
                    appIdentity = null,
                    rawResult = null,
                    parsedStatus = "UNSUPPORTED",
                    upiTransactionReference = null,
                    eventTimestamp = System.currentTimeMillis(),
                    idempotencyKey = pendingPayment.idempotencyKey,
                    metadata = mapOf("orderId" to pendingPayment.orderId)
                )
                submitReturnToServer(unsupportedReturn, pendingPayment) { callback(UpiLaunchResult.IntentLaunched) }
            }
            is UpiCaptureResult.DuplicateReturn -> {
                callback(UpiLaunchResult.IntentLaunched)
            }
        }
    }

    // ------------------------------------------------------------------
    // capturePaymentReturn()
    // ------------------------------------------------------------------
    /**
     * Captures and parses the return from an external UPI payment application.
     * Callable directly (e.g. in onActivityResult) or via launchPayment().
     */
    fun capturePaymentReturn(
        intent: Intent?,
        pendingPayment: PendingPayment
    ): UpiCaptureResult {
        return UpiResponseParser.parseIntentReturn(
            intent,
            attemptId = pendingPayment.attemptId,
            paymentId = pendingPayment.paymentId,
            correlationId = pendingPayment.correlationId,
            sourcePlatform = "ANDROID",
            appIdentity = null,
            idempotencyKey = pendingPayment.idempotencyKey,
            metadata = mapOf(
                "orderId" to pendingPayment.orderId,
                "amountPaise" to pendingPayment.amountPaise.toString(),
                "currency" to pendingPayment.currency,
                "receivingVpa" to pendingPayment.receivingVpa
            )
        )
    }

    // ------------------------------------------------------------------
    // parseUpiResponse() / normalizeReportedStatus()
    // ------------------------------------------------------------------
    /**
     * Parses a raw UPI response string/extras into a normalized UpiStatus.
     * Public so callers can inspect parsing without launching.
     */
    fun parseUpiResponse(rawStatus: String?, rawResult: String?): UpiStatus {
        return UpiResponseParser.normalizeReportedStatus(rawStatus, rawResult)
    }

    fun normalizeReportedStatus(rawStatus: String?, rawResult: String?): UpiStatus {
        return UpiResponseParser.normalizeReportedStatus(rawStatus, rawResult)
    }

    // ------------------------------------------------------------------
    // submitReturnToServer()
    // ------------------------------------------------------------------
    /**
     * Submits the buyer-reported payment return to Sanbookpay.
     * Attempts immediate transmission on return; never deliberately waits for the observer's
     * five-second cycle. On network failure, WorkManager-based retry is scheduled.
     *
     * The return is recorded as buyer-reported payment information, not bank-confirmed.
     */
    fun submitReturnToServer(
        pendingPayment: PendingPayment,
        callback: (UpiSubmitResult) -> Unit
    ) {
        val paymentReturn = pendingReturns[pendingPayment.idempotencyKey] ?: buildReturnFromPending(pendingPayment)
        transmitter.submit(paymentReturn, pendingPayment, callback)
    }

    /** Overload accepting an already-parsed UpiPaymentReturn. */
    fun submitReturnToServer(
        paymentReturn: UpiPaymentReturn,
        pendingPayment: PendingPayment,
        callback: (UpiSubmitResult) -> Unit
    ) {
        transmitter.submit(paymentReturn, pendingPayment, callback)
    }

    private fun buildReturnFromPending(pendingPayment: PendingPayment): UpiPaymentReturn {
        return UpiPaymentReturn(
            returnId = "ret_${System.currentTimeMillis()}",
            attemptId = pendingPayment.attemptId,
            paymentId = pendingPayment.paymentId,
            correlationId = pendingPayment.correlationId,
            sourcePlatform = "ANDROID",
            appIdentity = null,
            rawResult = null,
            parsedStatus = pendingPayment.lastServerStatus ?: "UNKNOWN",
            upiTransactionReference = null,
            eventTimestamp = pendingPayment.createdAt,
            idempotencyKey = pendingPayment.idempotencyKey,
            metadata = mapOf("orderId" to pendingPayment.orderId, "amountPaise" to pendingPayment.amountPaise.toString())
        )
    }

    // ------------------------------------------------------------------
    // resumePendingPayment()
    // ------------------------------------------------------------------
    /**
     * Resumes a pending payment after Android process death, app backgrounding, or
     * payment-application force-close. Reads the encrypted local store and, if the payment
     * has not expired, returns it for re-submission or re-launch.
     */
    fun resumePendingPayment(paymentId: String): PendingPayment? {
        return store.load(paymentId)?.takeIf { it.expiresAt > System.currentTimeMillis() }
    }

    /** All pending (unexpired, unsubmitted) payments eligible for recovery. */
    fun resumeAllPending(): List<PendingPayment> {
        return store.loadAllUnsubmitted().filter { it.expiresAt > System.currentTimeMillis() }
    }

    // ------------------------------------------------------------------
    // getServerPaymentStatus()
    // ------------------------------------------------------------------
    /**
     * Queries the server for the authoritative status of a payment.
     * Returns null when the server is unreachable (caller may rely on local pending state).
     */
    fun getServerPaymentStatus(paymentId: String, callback: (ServerPaymentStatus?) -> Unit) {
        transmitter.fetchStatus(paymentId, callback)
    }

    companion object {
        private const val PREFS_NAME = "sanbookpay_upi_intent_sdk"
        @Volatile private var instance: UpiIntentSdk? = null

        /**
         * Obtain (or lazily create) the SDK instance. Call from Application.onCreate.
         */
        fun getInstance(context: Context): UpiIntentSdk {
            return instance ?: synchronized(this) {
                instance ?: UpiIntentSdk(context.applicationContext).also { instance = it }
            }
        }

        fun resetInstance() {
            instance = null
        }
    }
}
