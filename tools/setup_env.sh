#!/usr/bin/env bash
# Installe la chaine de construction de SORIO.
#
# Le conteneur de developpement est ephemere : Godot disparait entre deux
# sessions. Ce script le reinstalle a l'identique, sans interaction.
#
#   ./tools/setup_env.sh
#
# Apres quoi toutes les commandes de CLAUDE.md fonctionnent.

set -euo pipefail

GODOT_VERSION="4.7.1-stable"
TOOLS_DIR="${SORIO_TOOLS_DIR:-$HOME/.local/share/sorio-tools}"
GODOT_BIN="$TOOLS_DIR/godot"
TEMPLATES_DIR="$HOME/.local/share/godot/export_templates/${GODOT_VERSION/-stable/.stable}"

BASE_URL="https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}"
GODOT_ZIP="Godot_v${GODOT_VERSION}_linux.x86_64.zip"
TEMPLATES_TPZ="Godot_v${GODOT_VERSION}_export_templates.tpz"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

mkdir -p "$TOOLS_DIR"

# --- Moteur -----------------------------------------------------------------
if [ -x "$GODOT_BIN" ] && "$GODOT_BIN" --headless --version 2>/dev/null | grep -q "4.7.1"; then
  log "Godot $GODOT_VERSION deja installe"
else
  log "Telechargement de Godot $GODOT_VERSION"
  curl -sSL --retry 4 --retry-delay 2 -o "$TOOLS_DIR/godot.zip" "$BASE_URL/$GODOT_ZIP"
  unzip -o -q "$TOOLS_DIR/godot.zip" -d "$TOOLS_DIR"
  mv "$TOOLS_DIR/Godot_v${GODOT_VERSION}_linux.x86_64" "$GODOT_BIN"
  chmod +x "$GODOT_BIN"
  rm -f "$TOOLS_DIR/godot.zip"
  log "Godot installe : $("$GODOT_BIN" --headless --version)"
fi

# --- Modeles d'export -------------------------------------------------------
# Necessaires pour produire un APK ou un binaire de bureau.
if [ -f "$TEMPLATES_DIR/android_debug.apk" ]; then
  log "Modeles d'export deja installes"
else
  log "Telechargement des modeles d'export (~1 Go, une seule fois)"
  curl -sSL --retry 4 --retry-delay 2 -o "$TOOLS_DIR/templates.tpz" "$BASE_URL/$TEMPLATES_TPZ"
  mkdir -p "$TOOLS_DIR/tpl" "$TEMPLATES_DIR"
  unzip -o -q "$TOOLS_DIR/templates.tpz" -d "$TOOLS_DIR/tpl"
  cp "$TOOLS_DIR"/tpl/templates/* "$TEMPLATES_DIR/"
  rm -rf "$TOOLS_DIR/tpl" "$TOOLS_DIR/templates.tpz"
  log "Modeles installes dans $TEMPLATES_DIR"
fi

# --- Premiere importation ---------------------------------------------------
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log "Importation des ressources du projet"
"$GODOT_BIN" --headless --path "$PROJECT_DIR" --import >/dev/null 2>&1 || true

cat <<EOF

$(log "Pret.")

  Moteur    : $GODOT_BIN
  Projet    : $PROJECT_DIR

Commandes utiles (voir CLAUDE.md) :

  $GODOT_BIN --path .
  $GODOT_BIN --headless --path . res://src/tools/validate_project.tscn
  $GODOT_BIN --headless --path . res://src/tools/run_tests.tscn

EOF
