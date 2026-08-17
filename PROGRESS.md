# SORIO — état d'avancement

12 passes (D.1). Une passe = un livrable testable en ligne de commande.

| Passe | Contenu | État |
|---|---|---|
| **0** | Fondations | ✅ **terminée** |
| **1** | Socle plateforme | ⏳ en cours |
| 2 | Niveaux ASCII | ⬜ à faire |
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

## Passe 1 — Socle plateforme ⏳

À livrer : `player.tscn`, machine à états, physique exacte de B.4 **avec
coyote time et jump buffer**, caméra à zone morte, panneau de debug F1, un
niveau de test, contrôles clavier + tactiles.

C'est la passe la plus importante du projet : on n'en sort pas tant que le
saut n'est pas juste.
