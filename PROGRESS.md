# SORIO — état d'avancement

12 passes (D.1). Une passe = un livrable testable en ligne de commande.

| Passe | Contenu | État |
|---|---|---|
| **0** | Fondations | ✅ **terminée** |
| **1** | Socle plateforme | ✅ **terminée** |
| **2** | Niveaux ASCII | ⏳ en cours |
| 3 | Ennemis et statuts | ⬜ à faire |
| 4 | Les 36 pouvoirs | ⬜ à faire |
| 5 | Ergonomie tactile | ⬜ à faire |
| 6 | Boss | ⬜ à faire |
| 7 | Les 8 mondes | ⬜ à faire |
| 8 | Mode Course | ⬜ à faire |
| 9 | Les 10 mini-jeux | ⬜ à faire |
| 10 | Interface et didacticiel | ⬜ à faire |
| 11 | Backend et audio | ⬜ à faire |
| 12 | Optimisation et APK | ⬜ à faire |

---

## Passe 0 — Fondations ✅

### Fait

**Configuration**
- `project.godot` complet : viewport 1280×720, `canvas_items`/`expand`,
  `gl_compatibility`, 60 Hz, `physics_jitter_fix = 0.5`, gravité 3600,
  filtre de texture linéaire + mipmaps, **paysage partout**.
- 12 couches de physique nommées, doublées par `CollisionLayers` et
  **vérifiées automatiquement** contre `project.godot`.
- Arborescence complète de B.2.

**Les 9 autoloads, fonctionnels et non vides**
- `EventBus` — ~50 signaux globaux couvrant joueur, pouvoirs, ennemis, boss,
  niveau, économie, interface, système.
- `Settings` — 6 sections, validation par bornes et par liste, persistance
  `ConfigFile`, application immédiate sans redémarrage.
- `Database` — indexation des `.tres` par `id`, doublon = erreur bloquante.
- `SaveManager` — 3 emplacements, **écriture atomique**, migrations versionnées.
- `Game` — état seul, aucune logique de gameplay.
- `AudioManager` — bus créés par code, fondu croisé, pool de 8 voix avec priorité.
- `Haptics` — table C.3 complète, séquence triple pour la victoire sur boss.
- `Perf` — 3 paliers, mesure sur 5 s, descente seule, jamais de remontée auto.
- `Transition` — fondus, pile d'écrans, **bouton retour Android** et mise en
  pause automatique en arrière-plan.

**Outils**
- `validate_project` — autoloads, couches, toutes scènes/ressources/scripts,
  intégrité de la Database.
- `run_tests` — runner maison, découverte automatique, 19 cas au vert.
- `generate_placeholders` — formes colorées **étiquetées**, grammaire de
  lisibilité de A.7 (liseré rouge = danger, halo clair = ramassable).
- `screenshot` — capture d'écran de n'importe quelle scène sous `xvfb`,
  sans éditeur. C'est le moyen de validation visuelle du projet.
- `placeholder_font` — fonte matricielle 3×5 dessinée pixel par pixel, pour
  étiqueter les placeholders en headless.

**Écrans**
- Boot → Titre fonctionnels, traduits, avec case « Je sais déjà jouer ».
- 10 écrans provisoires avec bouton retour opérationnel : **aucun écran mort,
  aucun bouton sans action, dès la passe 0**.

**Divers**
- `TouchButton` : les 11 critères de C.2 garantis par construction.
- `translations/sorio.csv` : 70 clés FR/EN.
- `tools/setup_env.sh` : réinstallation automatique du moteur.

### Vérifié

```
validate_project   → OK, 15 scènes, 21 scripts, 0 erreur
run_tests          → 19/19
generate_placeholders → 15 fichiers
screenshot         → build/title.png (1280×720)
```

### Bugs trouvés et corrigés pendant la passe

1. `Database._get()` entrait en collision avec la virtuelle `Object._get()`.
2. `PackedStringArray([...])` n'est pas une expression constante en GDScript.
3. `--script` ne crée pas les autoloads → tous les outils sont des scènes.
4. `CACHE_MODE_IGNORE` sur des scripts à `class_name` fait planter le moteur
   (signal 11) → `CACHE_MODE_REUSE`.
5. **`ResourceSaver` refusait l'extension `.tmp`** (erreur 15) : l'écriture
   atomique de la sauvegarde échouait silencieusement. Trouvé par le test
   `test_save_round_trip_preserves_progress`, corrigé en `.tmp.tres`.
6. Mise en page du titre : 6 boutons de 72 px débordaient l'écran.

---

## Bloqué par l'environnement

**Aucun APK signé ne peut être produit dans le conteneur de développement.**
`dl.google.com` et `maven.google.com` sont refusés par la politique réseau
(403 sur le CONNECT), donc pas de SDK Android, donc ni `apksigner` ni
`zipalign`.

Ce qui est prêt malgré tout : `export_presets.cfg` versionné et complet,
modèles d'export installés, `tools/build_apk.sh` écrit, procédure exacte dans
`docs/EXPORT_ANDROID.md`. Il suffit d'autoriser `dl.google.com` dans la
politique réseau de l'environnement, ou de lancer la construction en local.

---

## Passe 1 — Socle plateforme ✅

### Fait

**Physique de B.4, exacte**
- `PlayerConfig.tres` : les 13 valeurs de B.4, aucune codée en dur.
- La ressource calcule elle-même la portée du joueur — **213 px (3,3 tuiles)
  de haut, 303 px (4,7 tuiles) de portée**. Ce sont exactement les deux
  nombres dont `lint_levels` aura besoin en passe 2 : changer la gravité
  changera donc automatiquement la validation des niveaux.
- `validate()` refuse une configuration absurde au démarrage.

**Coyote time et jump buffer — vérifiés, pas ressentis**
Compteurs flottants plutôt que nœuds `Timer` : un `Timer` coûte jusqu'à une
frame d'imprécision sur une fenêtre de 0,10 s, ce qui est précisément ce
qu'on cherche à maîtriser. 8 cas de test font tourner de **vraies frames de
physique** et vérifient l'ouverture, l'expiration, l'absence de double saut,
le déclenchement à l'atterrissage et la hauteur variable.

**Machine à états**
6 états (Idle, Run, Jump, Fall, Hurt, Dead). Un état ne change jamais d'état
lui-même : il retourne un nom, la machine tranche — toutes les transitions
sont donc visibles au même endroit. Les 4 états liés aux pouvoirs (Dash,
Swing, Roll, Swim) arrivent en passe 4, avec les pouvoirs qui les déclenchent.

**Le reste**
- `player.tscn` : hurtbox, stompbox, 3 rayons de sol, ancre de pouvoir,
  écharpe distincte qui change de couleur avec les PV (A.3).
- `GameCamera` : zone morte, anticipation, tremblement désactivable.
- Panneau de debug **F1** : 10 curseurs qui modifient la physique **en
  jouant**, plus un bouton qui écrit le `.tres`. Le saut se règle au doigt.
- Niveau de test à 6 sections, chacune éprouvant un point précis de B.4.
- Contrôles tactiles : `VirtualJoystick` natif de 4.7 + boutons A/B/poche,
  mode gaucher déjà en place.

### Le point d'architecture de la passe

**Le tactile ne parle jamais au joueur.** Les contrôles à l'écran poussent
les mêmes actions Godot que le clavier (`Input.action_press`). Conséquences :
`Player` n'a pas une ligne de code spécifique au tactile, le multi-touch
marche gratuitement (trois doigts, trois nœuds indépendants), et un test
automatisé peut simuler une entrée exactement comme un vrai doigt.

### Vérifié

```
validate_project   → OK, 20 scènes, 37 scripts, 0 erreur
run_tests          → 30/30 (dont 11 de physique en simulation réelle)
screenshot         → docs/images/passe1_niveau.png
```

### Bugs trouvés et corrigés pendant la passe

1. La couleur d'écharpe teintait **tout** le sprite : SORIO devenait rouge
   sombre. L'écharpe est maintenant un nœud distinct — l'information est
   portée, pas noyée.
2. `SceneTree.physics_frame` est émis **avant** `_physics_process` : un appui
   simulé autour d'un seul `await` n'était jamais vu par le joueur.
3. **Le plus intéressant** : déplacer SORIO en l'air dans un test lui ouvre
   une fenêtre de coyote, exactement comme s'il quittait un rebord. Un de mes
   tests de jump buffer passait donc **pour la mauvaise raison** — le saut
   partait par le coyote, pas par le tampon. Corrigé en attendant explicitement
   la fermeture de la fenêtre.
4. Le runner de tests démarrait pendant `_ready`, quand la racine refuse
   encore les `add_child`.

![Niveau de test](images/passe1_niveau.png)

---

## Passe 2 — Niveaux ASCII ⏳

À livrer : `LevelBuilder`, format de B.6, `lint_levels` avec ses 6
vérifications, TileSet du monde 1, blocs cassables, plateformes traversables,
Cadeaux Surprise, ambres, points de contrôle, drapeau, et 3 vrais niveaux.
