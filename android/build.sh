#!/usr/bin/env bash
# Builds and signs the Android app (a Trusted Web Activity) without Android Studio, the same way as the expenses app.
# Needs (Ubuntu): aapt apksigner zipalign android-sdk-platform-23 dalvik-exchange, and a JDK.
# Usage: SITE_HOST=yachad-basal.pages.dev VERSION_CODE=2 VERSION_NAME=1.1 ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
SITE_HOST="${SITE_HOST:-yachad-basal.pages.dev}"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
ANDROID_JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
KS=signing/release.jks
OUT=build
PKG=il.yachadbasal.app

rm -rf "$OUT" && mkdir -p "$OUT/gen/il/yachadbasal/app" "$OUT/classes"

if [ ! -f "$KS" ]; then
  mkdir -p signing
  head -c 24 /dev/urandom | base64 | tr -d '/+=' > signing/password.txt
  keytool -genkeypair -keystore "$KS" -storepass "$(cat signing/password.txt)" -alias yachad \
    -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=Yachad BaSal" >/dev/null
fi
PASS="$(cat signing/password.txt)"

sed -e "s/@SITE_HOST@/$SITE_HOST/g" -e "s/@VERSION_CODE@/$VERSION_CODE/" -e "s/@VERSION_NAME@/$VERSION_NAME/" \
  AndroidManifest.xml.in > "$OUT/AndroidManifest.xml"
cat > "$OUT/gen/il/yachadbasal/app/BuildConfig.java" <<JAVA
package $PKG;
public final class BuildConfig {
    public static final String SITE_HOST = "$SITE_HOST";
}
JAVA

aapt package -f -M "$OUT/AndroidManifest.xml" -S res -I "$ANDROID_JAR" -J "$OUT/gen" \
  -F "$OUT/unsigned.apk" -0 arsc --min-sdk-version 24 --target-sdk-version 34
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$ANDROID_JAR" \
  -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
dalvik-exchange --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
apksigner sign --ks "$KS" --ks-pass "pass:$PASS" --ks-key-alias yachad --out "$OUT/yachad-basal.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/yachad-basal.apk"

# Digital Asset Links: lets Chrome open the site full screen inside the app, and invite links open in the app
FP=$(keytool -list -v -keystore "$KS" -storepass "$PASS" -alias yachad | sed -n 's/.*SHA256: //p')
cat > "$OUT/assetlinks.json" <<JSON
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": { "namespace": "android_app", "package_name": "$PKG", "sha256_cert_fingerprints": ["$FP"] }
}]
JSON
echo "Built $OUT/yachad-basal.apk for https://$SITE_HOST"

# The APK and the verification file are served by the web app (public/ is copied into the Cloudflare build)
mkdir -p ../public/.well-known
cp "$OUT/yachad-basal.apk" ../public/yachad-basal.apk
cp "$OUT/assetlinks.json" ../public/.well-known/assetlinks.json
echo "Copied yachad-basal.apk and .well-known/assetlinks.json into ../public"
