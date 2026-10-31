# Dynamo Bridge ProGuard Rules
-keep class com.dynamopay.bridge.** { *; }
-keep class androidx.security.crypto.** { *; }
-keep class okhttp3.** { *; }
-keep class org.json.** { *; }
-keep class com.google.zxing.** { *; }
-keep class com.journeyapps.barcodescanner.** { *; }

-dontwarn androidx.security.crypto.**
-dontwarn okhttp3.**
-dontwarn com.google.zxing.**
-dontwarn com.journeyapps.barcodescanner.**

-keepattributes Signature
-keepattributes *Annotation*

# Android Keystore
-keep class android.security.keystore.** { *; }
