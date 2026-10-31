# Dynamo Bridge — Security & Integrity

## Can I guarantee "virus free"?

**No — and no legitimate developer should claim that.** I cannot scan every Android device or guarantee the APK is free of all malware. What I can provide are verifiable integrity controls so you can confirm the APK you download is the one built from this source code.

## Integrity verification (recommended before installing)

1. **Download over HTTPS only.** The download endpoint serves URLs over TLS.
2. **Verify SHA256 checksum.** Each CI build publishes a `.sha256` file alongside the APK.
   ```
   # On your computer, after downloading:
   sha256sum app-debug.apk
   # Compare output to the .sha256 file content
   ```
3. **Compare checksums.** If they match, the APK is bit-for-bit identical to what was built in CI.

## What Dynamo Bridge does NOT collect

- UPI PIN
- Bank login password
- OTP
- Debit card details
- Private UPI app credentials (Google Pay, PhonePe, Paytm, BHIM, etc.)
- Accessibility service automation (not used)

## Permissions Dynamo Bridge requests

| Permission | Why |
|------------|-----|
| Notification access | To observe UPI credit alerts from your payment apps |
| Internet | To forward signed observation events to your backend |
| Camera | To scan the merchant pairing QR code |
| Foreground service | To keep the observer running in the background |
| Boot completed | To restart the observer after phone reboot |

## Release vs Debug builds

- **CI builds (debug):** Signed with a debug key. Suitable for testing on your own devices.
- **Play Store release:** Requires a separate release signing key configured in `build.gradle.kts` `signingConfigs.release`. Do not distribute debug builds to production merchants.

## Source code

All Dynamo Bridge source is in `apps/android-bridge/`. You can review it before building/installing.

## Reporting security concerns

Open an issue at https://github.com/Tashima-Tarsh/Sanbookpay/issues
