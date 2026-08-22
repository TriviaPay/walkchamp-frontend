# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# @generated begin expo-build-properties - expo prebuild (DO NOT MODIFY)
-keepattributes SourceFile,LineNumberTable,*Annotation*
-keep class com.globalwalkerleague.walkchampraceprogress.** { *; }
-keep class com.walkchamp.app.WalkChampNotificationServiceExtension { *; }
-keep class expo.modules.** { *; }
-keep class expo.modules.ExpoModulesPackageList { *; }
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }
-keep class com.onesignal.** { *; }
-keep class io.livekit.** { *; }
-keep class androidx.health.connect.** { *; }
-keep class com.android.billingclient.** { *; }
-keep class com.google.android.gms.ads.** { *; }
-keep @expo.modules.core.interfaces.DoNotStrip class *
-dontwarn com.facebook.react.**
-dontwarn com.swmansion.reanimated.**
# @generated end expo-build-properties