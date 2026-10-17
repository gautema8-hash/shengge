#!/usr/bin/env bash
# 「生格」WebView 壳 APK 构建（免 Gradle，aapt2 + javac + d8 + apksigner）
# 用法：bash tools/build-apk.sh
set -euo pipefail

SDK="D:/sofa/android/sdk"
BT="$SDK/build-tools/35.0.0"
AJ="$SDK/platforms/android-35/android.jar"
JDK="D:/sofa/jdk/jdk17"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/app/frontend/android-shell"
OUT="$SRC/build"
KS="$SRC/debug.keystore"

echo "▶ 1/6 清理并创建输出目录"
rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes"

echo "▶ 2/6 编译资源 (aapt2)"
"$BT/aapt2.exe" compile --dir "$SRC/res" -o "$OUT/res.zip"
"$BT/aapt2.exe" link -o "$OUT/base.apk" -I "$AJ" \
  --manifest "$SRC/AndroidManifest.xml" -R "$OUT/res.zip" --auto-add-overlay \
  --min-sdk-version 24 --target-sdk-version 35 \
  --version-code 1 --version-name 1.0.0 \
  --java "$OUT/gen"

echo "▶ 3/6 编译 Java (JDK17 --release 8)"
"$JDK/bin/javac.exe" -encoding UTF-8 --release 8 -classpath "$AJ" -d "$OUT/classes" \
  "$OUT/gen/com/shengge/app/R.java" \
  "$SRC/java/com/shengge/app/MainActivity.java"

echo "▶ 4/6 DEX (d8)"
"$BT/d8.bat" --release --lib "$AJ" --min-api 24 \
  --output "$OUT" "$OUT/classes/com/shengge/app/"*.class

echo "▶ 5/6 打包 classes.dex + 对齐"
python -c "import zipfile,sys; p=sys.argv[1]; z=zipfile.ZipFile(p,'a',zipfile.ZIP_DEFLATED); z.write(sys.argv[2],'classes.dex'); z.close()" "$OUT/base.apk" "$OUT/classes.dex"
"$BT/zipalign.exe" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "▶ 6/6 生成密钥并签名 (apksigner)"
if [ ! -f "$KS" ]; then
  "$JDK/bin/keytool.exe" -genkeypair -keystore "$KS" -alias shengge \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass shengge2026 -keypass shengge2026 \
    -dname "CN=Shengge Debug,O=LongYue,C=CN" >/dev/null 2>&1
fi
"$BT/apksigner.bat" sign --ks "$KS" --ks-pass pass:shengge2026 \
  --key-pass pass:shengge2026 --out "$OUT/shengge-v1.0.0-test.apk" "$OUT/aligned.apk"
"$BT/apksigner.bat" verify "$OUT/shengge-v1.0.0-test.apk" && echo "签名校验通过"

echo ""
echo "✅ APK: $OUT/shengge-v1.0.0-test.apk ($(du -h "$OUT/shengge-v1.0.0-test.apk" | cut -f1))"
