# Dynamo Bridge APK Build Script
# This script documents how to build the Dynamo Bridge APK.
# Requires Android SDK and Gradle installed.

# Prerequisites:
# 1. Install Android SDK (command line tools)
# 2. Set ANDROID_HOME environment variable
# 3. Install Gradle (gradle-wrapper.properties targets Gradle 8.5)

# First time only: generate the Gradle Wrapper bootstrap jar
# cd apps/android-bridge
# gradle wrapper

# Build commands:
# cd apps/android-bridge
# ./gradlew assembleDebug    # Build debug APK
# ./gradlew assembleRelease  # Build release APK (needs signing config)

# Output:
# app/build/outputs/apk/debug/app-debug.apk
# app/build/outputs/apk/release/app-release.apk

# To install on a device:
# adb install app/build/outputs/apk/debug/app-debug.apk
