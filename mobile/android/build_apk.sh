#!/usr/bin/env bash
# Construit budget-control.apk sans Gradle : aapt2 -> javac -> d8 -> zipalign ->
# apksigner. Pipeline volontairement minimal (une Activity WebView, assets html).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK:-$HOME/android-sdk}"
BT="$SDK/build-tools/34.0.0"
ANDROID_JAR="$SDK/platforms/android-34/android.jar"
MIN=21
TARGET=34

APP="$HERE/app/src/main"
BUILD="$HERE/build"
KS="$HERE/debug.keystore"
OUT="$HERE/budget-control.apk"

command -v "$BT/aapt2" >/dev/null || { echo "aapt2 introuvable dans $BT"; exit 1; }
[ -f "$ANDROID_JAR" ] || { echo "android.jar introuvable : $ANDROID_JAR"; exit 1; }

echo ">> Nettoyage"
rm -rf "$BUILD"; mkdir -p "$BUILD/compiled" "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$BUILD/assets"

echo ">> Copie des assets (www)"
cp -r "$HERE/../www" "$BUILD/assets/www"

echo ">> aapt2 compile (ressources)"
"$BT/aapt2" compile --dir "$APP/res" -o "$BUILD/compiled/res.zip"

echo ">> aapt2 link"
"$BT/aapt2" link -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  -A "$BUILD/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version "$MIN" --target-sdk-version "$TARGET" \
  "$BUILD/compiled/res.zip"

echo ">> javac"
javac -source 8 -target 8 -nowarn \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
  -d "$BUILD/classes" \
  "$APP/java/com/budgetcontrol/app/"*.java \
  "$BUILD/gen/com/budgetcontrol/app/"*.java 2>/dev/null

echo ">> d8 (dex)"
"$BT/d8" --lib "$ANDROID_JAR" --min-api "$MIN" --output "$BUILD/dex" \
  $(find "$BUILD/classes" -name '*.class')

echo ">> Ajout de classes.dex dans l'APK"
cp "$BUILD/dex/classes.dex" "$BUILD/classes.dex"
( cd "$BUILD" && zip -q base.apk classes.dex )

echo ">> zipalign"
"$BT/zipalign" -f -p 4 "$BUILD/base.apk" "$BUILD/aligned.apk"

if [ ! -f "$KS" ]; then
  echo ">> Creation d'un keystore de debug"
  keytool -genkeypair -v -keystore "$KS" -storepass android -keypass android \
    -alias budgetcontrol -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Budget Control, O=Local, C=FR" >/dev/null 2>&1
fi

echo ">> Signature"
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --min-sdk-version "$MIN" --out "$OUT" "$BUILD/aligned.apk"

echo ">> Verification de la signature"
"$BT/apksigner" verify --min-sdk-version "$MIN" --print-certs "$OUT" | head -3

echo ">> Contenu (permissions / lanceur)"
aapt dump badging "$OUT" 2>/dev/null | grep -E "^package|uses-permission|launchable-activity|application-label:" || true

echo ""
echo "APK genere : $OUT"
ls -la "$OUT"
