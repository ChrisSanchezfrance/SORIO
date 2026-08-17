# SORIO — état d'avancement

12 passes (D.1). Une passe = un livrable testable en ligne de commande.

| Passe | Contenu | État |
|---|---|---|
| **0** | Fondations | ✅ **terminée** |
| **1** | Socle plateforme | ✅ **terminée** |
| **2** | Niveaux ASCII | ⬜ à faire |
| 3 | Ennemis et statuts | ⬜ à faire |
| **4** | Les 36 pouvoirs | 🟡 données + système, effets à venir |
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
  **Les trous sont calibrés sur la portée réelle du saut** : 2, 2 et 3 tuiles,
  soit 42 %, 42 % et 63 % des 4,73 tuiles atteignables. Un plafond de 70 % est
  inscrit dans le code (`MAX_GAP_RATIO`) et vérifié au chargement comme par
  un test — c'est la règle 5 de B.6 appliquée dès la passe 1. Un trou calibré
  à 100 % serait franchissable en théorie et injouable en pratique.
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

## Hors passe — demandes du 17/08 ✅

### SORIO en forme humaine, partout

Le placeholder rectangulaire est remplacé par un **vrai personnage** dessiné
par squelette articulé : tête, cheveux, gros yeux, tunique verte, bras,
jambes, bottes, et un cycle de course en 4 images.

`src/tools/character_drawer.gd` définit un pantin de 12 articulations ; une
pose n'est qu'un jeu de coordonnées. **20 poses, 12 animations**, générées en
headless sans éditeur ni logiciel de dessin. PAPI et GRANNA partagent le même
squelette et ne diffèrent que par la palette.

Comme B.7 impose au mode Course d'utiliser **strictement les mêmes textures**
que la 2D, le faire une fois le fait partout : plateforme, Course et
mini-jeux. Aucune divergence possible.

![Poses de SORIO](images/sorio_poses.png)

### Contrôles tactiles

**Schéma retenu** : le stick ne fait *que* le déplacement latéral et
l'accroupissement ; A saute, B frappe, C lance le pouvoir. Le haut du stick
est branché sur une action que rien ne consomme — le saut est donc impossible
depuis le stick **par construction**, et un test le vérifie en poussant
réellement vers le haut.

Deux mécaniques nouvelles accompagnent les boutons :
- **Le coup (B)** — boîte d'attaque devant SORIO, active 0,16 s, délai de
  0,30 s. Utilisable dans tous les états, y compris en plein saut : un enfant
  qui appuie doit voir SORIO frapper, pas se faire refuser l'action.
- **L'accroupi (bas du stick)** — nouvel état, capsule de collision
  raccourcie de 112 à 64 px. On ne se déplace pas accroupi : une vitesse de
  plus à comprendre pour un gain nul. Le saut reste prioritaire, donc rester
  accroupi ne piège jamais.

Joystick 270 px à gauche, trois boutons à droite en triangle (A 180 px dans
le coin, B et C 144 px), écartés de 40 px — bien au-delà des 24 px minimum, parce
qu'avec trois cibles voisines un doigt d'enfant doit pouvoir se tromper de
quelques millimètres. Réglages après plusieurs allers-
retours à l'écran : stick **180 px**, A **120 px**, B **96 px** — tous très
au-dessus du plancher de 64 px de C.2. Options > Taille des boutons multiplie
ces valeurs (Petit ×0,85 → Très grand ×1,5).

**Le stick est à 5 % d'opacité au repos** et redevient franc dès qu'on le
touche, en 80 ms. On sait où poser son pouce sans qu'un anneau blanc mange la
vue du niveau ; mais pendant qu'on pousse, il faut voir dans quelle direction.

**L'échange de poche** (C.1) n'a plus de bouton dédié : il passera par une
icône du HUD en passe 4, quand les pouvoirs existeront.

**15 tests de disposition** montent les vrais contrôles et mesurent les
vraies positions : marges de bord, aucune paire de boutons trop proche, stick
entièrement à l'écran, opacité de repos, miroir gaucher complet, et le fait
qu'aucun réglage de taille ne fasse passer un bouton sous 64 px ni sortir de
l'écran. **8 tests de comportement** couvrent le coup et l'accroupi.

![Contrôles doublés](images/passe1_controles.png)

### Les 36 pouvoirs, et SORIO qui se transforme

Chaque Cadeau Surprise contient **un pouvoir**, tiré selon la table de rareté
de A.6 (commun 60 %, rare 30 %, épique 9 %, légendaire 1 %). L'objet porte
déjà la couleur du pouvoir avant d'être absorbé.

**Le pouvoir se voit sur SORIO.** Tunique et pantalon prennent sa couleur, un
halo l'entoure. C'est le point important : un enfant de 8 ans ne lit pas un
HUD, il regarde son bonhomme. Le HUD ne fait que confirmer, avec la jauge
circulaire de A.6 — qui descend avec le temps ou avec les charges, et vire au
rouge dans le dernier quart.

Technique : un **shader** remplace les deux couleurs de la tenue au pixel
près, plutôt que de générer 36 × 20 images. `modulate` ne convenait pas — il
aurait teint la peau, les cheveux, et surtout **l'écharpe**, qui porte les PV
(A.3). Un test vérifie qu'aucune couleur d'écharpe ne peut être confondue
avec la tunique.

Le pouvoir sert de **bouclier** : prendre un dégât le fait perdre avant de
retirer un PV (A.6).

**Le bug le plus grave trouvé jusqu'ici.** À l'export, Godot convertit les
ressources texte en binaire et les renomme. `Database` ne cherchait que
l'extension `.tres` : 36 pouvoirs en développement, **zéro dans le jeu
livré**. Les cadeaux s'ouvraient sur du vide, et rien ne le signalait — ni la
validation, ni les 120 tests, qui tournent tous sur le projet source. Seul un
playtest dans le vrai build exporté pouvait le révéler.

![SORIO sous pouvoir Lave](images/passe4_pouvoir.png)

### Cadeaux Surprise et objets absorbés

Caisse solide : SORIO marche dessus, s'y cogne, la casse. **Trois façons de
l'ouvrir**, toutes équivalentes — coup de tête par en dessous, coup (B),
pouvoir (C, dès la passe 4, sans une ligne à changer : tout ce qui vient du
joueur ouvre le cadeau).

Le contenu ne flotte pas 10 s comme le prévoyait A.6 : il jaillit en éventail,
puis **fonce sur SORIO et se fait absorber**. Sur téléphone, courir après une
récompense qui va expirer — le pouce déjà occupé à courir et sauter — est une
frustration pure.

**Deux bugs que seuls les tests ont pu trouver :**

1. *Le contenu tournait autour du joueur sans jamais l'atteindre.* Une
   poursuite par accélération pure dépasse la cible, doit faire demi-tour, la
   dépasse encore — elle orbite. Corrigé en visant une **vitesse voulue**
   plutôt qu'en accélérant aveuglément, avec un plafond qui interdit de
   parcourir plus que la distance restante en une frame.
2. *Le coup de tête ne marchait jamais en jeu.* `move_and_slide()` annule la
   composante verticale de la vitesse **au moment du contact** : lue après
   coup, elle valait zéro. Mes tests unitaires appelaient `head_bump(-400)`
   directement et passaient ; c'est un **playtest dans un vrai navigateur**
   qui l'a révélé. La vitesse d'avant l'impact est désormais mémorisée, et un
   test d'intégration passe maintenant par une vraie collision.

![Cadeaux dans le niveau](images/passe1_cadeaux.png)

### Décor de fond : parallaxe à 4 plans

Le niveau n'était qu'un aplat sombre. Il a maintenant la **vallée en plein
jour** : ciel dégradé, soleil, nuages qui dérivent, chaîne de montagnes,
**volcan fumant** sur l'horizon, et une double rangée d'arbres.

Les 4 plans de B.10 sont en place — ciel (×0,04), nuages (×0,12), montagnes
et volcan (×0,30), forêt (×0,60), plateformes (×1,0) — et le nombre de plans
affichés suit `Perf.parallax_layers()` : 4 au palier haut, 3 au moyen, 2 au
bas. Les nuages tombent en premier, jamais les arbres : on sacrifie ce qui
aide le moins à lire le niveau.

**Décision technique.** Une première version peignait le décor pixel par
pixel et **ne rendait toujours pas après dix minutes** : en GDScript, écrire
dans un `PackedByteArray` membre recopie tout le tableau à chaque
affectation. Tout a été refait en `Polygon2D` remplis par le GPU. C'est plus
rapide, plus léger, plus net — et ça colle mieux au style demandé (formes
arrondies, contours nets, couleurs saturées). **Aucune texture de décor n'est
stockée dans le dépôt** : un monde tient dans une palette et quelques nombres.

Les silhouettes se répètent sans couture parce qu'elles sont définies par des
sommes de sinus à **fréquence entière** sur la largeur : une telle courbe
revient exactement à sa valeur de départ au bord droit. **12 tests** vérifient
ces invariants, y compris que les nuages ne chevauchent pas le raccord et que
le volcan ne dépasse pas 55 % de la largeur — une première version en faisait
1120 px sur 1280 et écrasait la scène.

![Vallée en plein jour](images/passe1_decor.png)

### Les mini-jeux entrent dans l'aventure

Écart assumé avec A.10, qui les réservait au Camp. `LevelFlow` décide
désormais de tout l'enchaînement — niveau suivant, intermède, boss, Village —
et tient quatre règles, chacune couverte par un test :

| Règle | Pourquoi |
|---|---|
| Gratuit | un mini-jeu imposé ne peut pas être payant |
| Sautable | un enfant qui n'aime pas ce jeu ne doit pas rester coincé |
| Jamais deux fois | joué **ou** passé, il ne revient pas au même endroit |
| Jamais avant un boss | on n'interrompt pas la montée de tension |

Rythme : un intermède tous les 3 niveaux (deux par monde), choisi par une
rotation **déterministe** couvrant les 10 mini-jeux. Les 10 `MinigameData.tres`
sont écrits et indexés par la `Database`, avec une durée d'intermède
raccourcie à 30 s pour ne pas casser l'élan du niveau suivant.

Le Camp reste en place pour rejouer, avec l'économie de A.10.

**17 nouveaux tests**, dont un qui vérifie que chaque mini-jeu cité dans la
rotation existe vraiment en ressource — sinon l'intermède ouvrirait un écran
vide en pleine partie.

```
validate_project → OK, 20 scènes, 14 ressources, 41 scripts
run_tests        → 120/120
```

---

## Passe 2 — Niveaux ASCII ⏳

À livrer : `LevelBuilder`, format de B.6, `lint_levels` avec ses 6
vérifications, TileSet du monde 1, blocs cassables, plateformes traversables,
Cadeaux Surprise, ambres, points de contrôle, drapeau, et 3 vrais niveaux.
