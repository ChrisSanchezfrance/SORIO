#!/usr/bin/env bash
# Construit l'APK Android de SORIO.
#
#   ./tools/build_apk.sh debug     -> build/sorio-debug.apk
#   ./tools/build_apk.sh release   -> build/sorio.apk
#
# Prerequis : voir docs/EXPORT_ANDROID.md. Le script verifie tout avant de
# lancer quoi que ce soit et dit precisement ce qui manque.

set -euo pipefail

MODE="${1:-debug}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GODOT="${SORIO_GODOT:-$HOME/.local/share/sorio-tools/godot}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
DEBUG_KEYSTORE="${SORIO_DEBUG_KEYSTORE:-$HOME/.android/debug.keystore}"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mERREUR\033[0m %s\n' "$*" >&2; exit 1; }

# --- Verifications ----------------------------------------------------------

[ -x "$GODOT" ] || fail "Godot introuvable : $GODOT (lancer ./tools/setup_env.sh)"

TEMPLATES_DIR="$HOME/.local/share/godot/export_templates/4.7.1.stable"
[ -f "$TEMPLATES_DIR/android_debug.apk" ] \
  || fail "Modeles d'export Android absents (lancer ./tools/setup_env.sh)"

[ -d "$ANDROID_HOME" ] \
  || fail "SDK Android absent : $ANDROID_HOME — voir docs/EXPORT_ANDROID.md"

# apksigner et zipalign viennent de build-tools ; sans eux, pas d'APK signe.
BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -V | tail -1)"
[ -n "$BUILD_TOOLS" ] || fail "build-tools absent du SDK — voir docs/EXPORT_ANDROID.md"
[ -x "$BUILD_TOOLS/apksigner" ] || fail "apksigner introuvable dans $BUILD_TOOLS"

if [ "$MODE" = "debug" ]; then
  [ -f "$DEBUG_KEYSTORE" ] \
    || fail "Keystore de debug absent : $DEBUG_KEYSTORE — voir docs/EXPORT_ANDROID.md"
else
  [ -n "${SORIO_RELEASE_KEYSTORE:-}" ] \
    || fail "SORIO_RELEASE_KEYSTORE non defini (le keystore de release n'est jamais commite)"
  [ -f "$SORIO_RELEASE_KEYSTORE" ] \
    || fail "Keystore de release introuvable : $SORIO_RELEASE_KEYSTORE"
fi

# --- Validation avant construction ------------------------------------------
# On ne fabrique jamais un APK a partir d'un projet qui ne valide pas.

log "Validation du projet"
"$GODOT" --headless --path "$PROJECT_DIR" res://src/tools/validate_project.tscn \
  || fail "validate_project a echoue : APK non construit"

log "Tests unitaires"
"$GODOT" --headless --path "$PROJECT_DIR" res://src/tools/run_tests.tscn \
  || fail "des tests echouent : APK non construit"

# --- Construction -----------------------------------------------------------

mkdir -p "$PROJECT_DIR/build"

if [ "$MODE" = "debug" ]; then
  OUT="$PROJECT_DIR/build/sorio-debug.apk"
  log "Export debug -> $OUT"
  "$GODOT" --headless --path "$PROJECT_DIR" --export-debug "Android" "$OUT"
else
  OUT="$PROJECT_DIR/build/sorio.apk"
  log "Export release -> $OUT"
  "$GODOT" --headless --path "$PROJECT_DIR" --export-release "Android" "$OUT"
fi

[ -f "$OUT" ] || fail "l'export n'a produit aucun fichier"

log "Verification de la signature"
"$BUILD_TOOLS/apksigner" verify --print-certs "$OUT" >/dev/null \
  || fail "l'APK n'est pas correctement signe"

log "Termine : $OUT ($(du -h "$OUT" | cut -f1))"
echo
echo "  Installation :  adb install -r $OUT"
echo "  Journal      :  adb logcat -s godot"
