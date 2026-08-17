# Export Android

## État dans le conteneur de développement

**Bloqué par la politique réseau de l'environnement.** `dl.google.com` et
`maven.google.com` répondent 403 au CONNECT, donc le SDK Android — et avec lui
`apksigner` et `zipalign` — ne peut pas être installé ici.

Ce qui est déjà en place :

- modèles d'export Godot 4.7.1 installés (`android_debug.apk`, `android_release.apk`) ;
- `export_presets.cfg` versionné et complet ;
- `tools/build_apk.sh` prêt à s'exécuter.

Deux façons de débloquer :

1. **Autoriser `dl.google.com`** dans la politique réseau de l'environnement
   (réglages de l'environnement sur claude.ai/code), puis lancer
   `./tools/build_apk.sh debug` — tout le reste est déjà écrit ;
2. **Construire en local** avec la procédure ci-dessous.

---

## Prérequis

| Élément | Version |
|---|---|
| JDK | **17** (Godot 4.7 ne garantit rien au-delà pour le build Gradle) |
| Android SDK | `cmdline-tools`, `build-tools;34.0.0`, `platform-tools`, `platforms;android-34` |
| Modèles d'export | **exactement 4.7.1-stable**, même version que le moteur |
| Keystore de debug | généré une fois, voir plus bas |

---

## Installation du SDK

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
mkdir -p "$ANDROID_HOME/cmdline-tools"

curl -sSL -o /tmp/cmdline-tools.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q /tmp/cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"
mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"

yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" "build-tools;34.0.0" "platforms;android-34"
```

## Keystore de debug

```bash
keytool -genkeypair -v \
  -keystore ~/.android/debug.keystore \
  -storepass android -keypass android \
  -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Android Debug,O=Android,C=US"
```

**Le keystore de release n'est jamais commité** — `.gitignore` couvre
`*.keystore` et `*.jks`. Il se passe par variables d'environnement :

```bash
export SORIO_RELEASE_KEYSTORE=/chemin/vers/release.keystore
export SORIO_RELEASE_KEYSTORE_USER=sorio
export SORIO_RELEASE_KEYSTORE_PASS=...
```

## Réglages du moteur

```bash
GODOT=~/.local/share/sorio-tools/godot
"$GODOT" --headless --editor-pid 0 \
  --path . --quit >/dev/null 2>&1 || true
```

Puis dans `~/.config/godot/editor_settings-4.7.tres`, ou par variables :

```
export/android/android_sdk_path = "$ANDROID_HOME"
export/android/debug_keystore   = "$HOME/.android/debug.keystore"
export/android/debug_keystore_user = "androiddebugkey"
export/android/debug_keystore_pass = "android"
```

## Construction

```bash
./tools/build_apk.sh debug     # build/sorio-debug.apk
./tools/build_apk.sh release   # build/sorio.apk
```

Ou directement :

```bash
$GODOT --headless --path . --export-debug   "Android" build/sorio-debug.apk
$GODOT --headless --path . --export-release "Android" build/sorio.apk
```

## Installation sur le téléphone

```bash
adb install -r build/sorio-debug.apk
adb logcat -s godot            # journal du jeu
```

---

## Réglages de l'export (déjà dans `export_presets.cfg`)

| Réglage | Valeur | Raison |
|---|---|---|
| `package/unique_name` | `com.sorio.game` | D.4 |
| Nom de l'app | SORIO | |
| Architectures | `arm64-v8a` + `armeabi-v7a` | couverture maximale |
| Orientation | **landscape** | paysage partout, mode Course inclus |
| Mode immersif | activé | barres système masquées |
| `gl_compatibility` | activé | téléphones d'entrée de gamme |
| Textures | ETC2/ASTC | |

## Comportements gérés côté code

- **Bouton retour matériel** — `NOTIFICATION_WM_GO_BACK_REQUEST` capté par
  `Transition`, qui émet `EventBus.back_requested`. Chaque écran décide :
  ouvre la pause en jeu, recule d'un écran dans les menus, demande
  confirmation sur l'écran titre. `config/quit_on_go_back = false` dans
  `project.godot` empêche Godot de quitter tout seul.
- **Mise en veille / arrière-plan** —
  `NOTIFICATION_APPLICATION_FOCUS_OUT` met le jeu en pause et coupe le bus
  Master, pour ne pas jouer de musique par-dessus une autre application.
- **Écran allumé** — `keep_screen_on = true`.
