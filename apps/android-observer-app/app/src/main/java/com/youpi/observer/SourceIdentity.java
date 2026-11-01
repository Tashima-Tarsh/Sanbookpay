package com.youpi.observer;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.security.MessageDigest;

/** Origin identity comes from Android, never from notification title/body text. */
public final class SourceIdentity {
    private SourceIdentity() {}
    public static String certificateSha256(Context context, String packageName) {
        try {
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = context.getPackageManager().getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = info.signingInfo.getApkContentsSigners();
            } else {
                PackageInfo info = context.getPackageManager().getPackageInfo(packageName, PackageManager.GET_SIGNATURES);
                signatures = info.signatures;
            }
            if (signatures == null || signatures.length != 1) return null;
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
            StringBuilder result = new StringBuilder();
            for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02X", value & 0xff));
            return result.toString();
        } catch (Exception unavailable) { return null; }
    }
}
