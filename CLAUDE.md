# SORIO — conventions, commandes et état

Fichier relu au début de chaque session. Il décrit **comment on travaille sur
ce projet**, pas ce que le jeu raconte.

---

## 1. Stack

| Élément | Valeur |
|---|---|
| Moteur | **Godot 4.7.1-stable** (`a13da4feb`) |
| Langage | GDScript, **typage statique obligatoire partout** |
| Rendu | `gl_compatibility` sur mobile **et** bureau |
| Viewport | 1280 × 720, `canvas_items` + `expand` |
| Orientation | **paysage partout**, y compris le mode Course |
| Physique | 60 Hz, `physics_jitter_fix = 0.5`, gravité 3600 px/s² |
| Unité | 1 tuile = **64 px** |
| Tests | runner maison (`tests/test_case.gd`), **pas GUT** |
| Cible | Android, `arm64-v8a` + `armeabi-v7a`, `com.sorio.game` |

### Pourquoi pas GUT

L'addon n'est pas récupérable depuis l'environnement de construction (accès
réseau restreint), et D.7 interdit d'ajouter un autre addon externe sans
accord. Le runner maison fait le travail en ~200 lignes, sans dépendance :
`src/tools/run_tests.gd` + `tests/test_case.gd`.

### Orientation paysage partout

Décision prise avec le porteur du projet : la bascule paysage → portrait en
cours de partie recrée le contexte de rendu sur Android (micro-gel, risque de
plantage sur entrée de gamme). Le mode Course garde donc ses 3 couloirs et ses
gestes, en paysage. **Aucun appel à `DisplayServer.screen_set_orientation()`
dans le projet.**

---

## 2. Installation

```bash
./tools/setup_env.sh
```

Réinstalle Godot 4.7.1 et les modèles d'export. **À relancer à chaque nouvelle
session de développement** : le conteneur est éphémère et le moteur disparaît
entre deux sessions. Le script est idempotent.

---

## 3. Commandes

Le binaire vit dans `~/.local/share/sorio-tools/godot`. Exporté ci-dessous en
`$GODOT` pour la lisibilité.

```bash
GODOT=~/.local/share/sorio-tools/godot

# Lancer le jeu
$GODOT --path .

# Valider que toutes les scènes, ressources et scripts chargent
$GODOT --headless --path . res://src/tools/validate_project.tscn

# Tests unitaires
$GODOT --headless --path . res://src/tools/run_tests.tscn

# Générer les placeholders manquants
$GODOT --headless --path . res://src/tools/generate_placeholders.tscn

# Valider tous les niveaux ASCII                        (à partir de la passe 2)
$GODOT --headless --path . res://src/tools/lint_levels.tscn

# Capture d'écran d'une scène, sans éditeur
xvfb-run -a $GODOT --path . --resolution 1280x720 \
  res://src/tools/screenshot.tscn -- \
  --scene=res://src/scenes/title/title.tscn --out=build/title.png

# Réimporter après ajout d'un asset ou d'une classe globale
$GODOT --headless --path . --import
```

### Les outils sont des scènes, pas des scripts

`godot --headless --script fichier.gd` **ne crée pas les autoloads**. Comme la
moitié du projet référence `EventBus` ou `Settings`, valider ainsi ferait
échouer tous les fichiers pour une mauvaise raison. Chaque outil de
`src/tools/` est donc un couple `.gd` (`extends Node`) + `.tscn`, lancé comme
scène principale, qui sort via `get_tree().quit(code)`.

---

## 4. Règles de code permanentes

1. **Typage statique partout.** `func take_damage(amount: int, type: StringName) -> void:`
2. **Aucun nombre magique.** Tout dans une `Resource` ou une constante nommée.
3. **Aucune allocation dans `_physics_process`.** Pooling obligatoire.
4. **Aucun `get_node("../../..")`.** `EventBus` ou référence injectée.
5. **Un script > 300 lignes est un signal de découpage.**
6. **Aucun texte affiché en dur.** Tout par `tr("CLE")` → `translations/sorio.csv`.
7. **`assert()` sur toutes les préconditions.**
8. Chaque fonctionnalité livrée avec son moyen de test.
9. **Aucun `.tscn` livré sans être passé par `validate_project`.**
10. Chaque `Resource` a un `id: StringName` unique (doublon = erreur bloquante).

### Conventions de nommage

- Commentaires et documentation : **français**, sans accents dans les fichiers
  `.gd` (Godot les gère, mais l'uniformité évite les diffs parasites).
- Identifiants, noms de fichiers, noms de nœuds : **anglais**.
- Fichiers : `snake_case.gd`, classes : `PascalCase`, constantes : `SCREAMING_CASE`.
- Tests : `tests/<sujet>_test.gd`, étend `TestCase`, méthodes `test_*`.

---

## 5. Points d'architecture à ne pas contourner

| Point | Fichier | Règle |
|---|---|---|
| Couches de physique | `src/systems/collision_layers.gd` | Jamais un entier nu comme masque. `validate_project` vérifie la cohérence avec `project.godot`. |
| Boutons tactiles | `src/scenes/ui/touch_button.gd` | **Seul bouton du jeu.** Les 11 critères de C.2 sont garantis par construction, pas par relecture. |
| Contenu | `resources/**.tres` via `Database` | Jamais de `load("res://resources/...")` ailleurs. |
| Changement d'écran | `Transition.go_to()` | Aucune scène chargée en dur ailleurs. |
| Vibration | `Haptics.pulse(&"clé")` | Jamais `Input.vibrate_handheld()` en direct. |
| Sauvegarde | `SaveManager` | Écriture atomique `.tmp.tres` → renommage. L'extension `.tres` est obligatoire : `ResourceSaver` choisit son format d'après l'extension. |

---

## 6. État

Voir `PROGRESS.md`. Résumé : **passe 0 terminée**, passe 1 en cours.

---

## 7. Points bloqués par l'environnement

**Chaîne Android indisponible dans le conteneur de développement.**
`dl.google.com` et `maven.google.com` sont refusés par la politique réseau
(403 sur le CONNECT). Sans SDK Android il n'y a ni `apksigner` ni `zipalign`,
donc **aucun APK signé ne peut être produit ici**.

Tout le reste est prêt : `export_presets.cfg` est versionné et complet, les
modèles d'export sont installés, `docs/EXPORT_ANDROID.md` donne la procédure
exacte. Deux issues :

- autoriser `dl.google.com` dans la politique réseau de l'environnement
  (réglages de l'environnement sur claude.ai/code) — l'APK se construit alors
  ici avec `tools/build_apk.sh` ;
- ou construire l'APK sur une machine locale avec la même procédure.

En attendant, la validation visuelle passe par `src/tools/screenshot.tscn`.
