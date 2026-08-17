# Ajouter du contenu à SORIO

Le principe du projet : **ajouter du contenu ne doit pas demander de code.**
Cette page dit où écrire quoi. Elle grandit passe après passe.

---

## Ajouter un pouvoir *(à partir de la passe 4)*

Un fichier, zéro ligne de code — tant que la famille d'effet existe déjà.

1. Créer `resources/powers/mon_pouvoir.tres`.
2. Renseigner `id` (unique, `StringName`), `name_key`, `description_key`,
   `family`, `rarity`, et soit `duration`, soit `charges`.
3. Remplir `effects` avec une ou plusieurs des **8 briques** (A.6.3) :
   `SpawnProjectileEffect`, `AuraEffect`, `StatModifierEffect`, `BurstEffect`,
   `SummonEffect`, `ShieldEffect`, `MovementEffect`, `WorldEffect`.
4. Ajouter `POWER_MON_POUVOIR_NAME` et `..._DESC` dans `translations/sorio.csv`.
5. `generate_placeholders` fabrique l'icône automatiquement.

```bash
$GODOT --headless --path . res://src/tools/generate_placeholders.tscn
$GODOT --headless --path . res://src/tools/validate_project.tscn
```

Un `id` en double est une **erreur bloquante** signalée au démarrage.

---

## Ajouter un ennemi *(à partir de la passe 3)*

1. Créer `resources/enemies/mon_ennemi.tres` : PV, vitesse, `behavior`,
   faiblesses, récompense, **symbole daltonien** (C.8).
2. Choisir un `behavior` parmi les 15 existants (`Patrol`, `PatrolEdgeAware`,
   `Charger`, `Diver`, `Roller`, `Jumper`, `Ambusher`, `Spitter`, `Static`,
   `Swarm`, `Rebuilder`, `Grower`, `Crawler`, `Sleeper`, `Swimmer`).
3. Lui attribuer une lettre dans la légende ASCII ci-dessous.

Une **variante de monde** (palette + modificateur) est un champ du `.tres`,
pas un nouveau fichier de comportement.

---

## Ajouter un niveau *(à partir de la passe 2)*

Un niveau est un `.txt`, jamais un dessin dans l'éditeur.

`levels/world_01/level_04.txt` :

```
---
name: LEVEL_1_4_NAME
world: 1
time_limit: 120
music: bgm_world_01
tileset: ferns
checkpoints: [24, 58]
---
................................................
......?.........o.o.o...........................
.....###.......=====......?.....................
..S.......r..............p.....###...........F..
################.....^^^....####################
```

### Légende

| Char | Élément | Char | Élément |
|---|---|---|---|
| `.` | vide | `S` | spawn du joueur |
| `#` | bloc solide | `F` | drapeau de fin |
| `=` | plateforme traversable par le bas | `C` | point de contrôle |
| `?` | Cadeau Surprise | `A` | ambre caché (compte pour l'étoile) |
| `o` | ambre | `^` | pic |
| `B` | bloc cassable | `~` | eau |
| `M` | plateforme mobile | `L` | lave |

Ennemis : `r` RAPTOZ · `g` GUEULE-PIÈGE · `p` PTÉRODARD · `c` COMPSO-NUÉE ·
`w` LIANE-FOUET · `q` AQUASAURE · `t` TRICRASH · `f` FOSSILE-MARCHEUR ·
`h` BRACCHIO-TOUR · `k` STÉGOPIK · `n` ANKYLO-BOULE · `v` RONCE-RAMPANTE ·
`d` DILO-CRACHEUR · `l` LARVE-AMBRE · `e` VÉGÉSAURE · `y` CRACHE-SPORE ·
`j` BOURGEON-BONDISSANT

### Validation obligatoire

```bash
$GODOT --headless --path . res://src/tools/lint_levels.tscn
```

Le lint vérifie six choses (B.6) : un seul `S` et un seul `F`, exactement
3 `A`, le `F` **atteignable** par simulation de saut, aucun ennemi enfermé
dans un bloc, aucun saut au-delà de la portée du joueur sans pouvoir, et un
temps limite atteignable.

**Un niveau qui échoue au lint n'est pas livré.** Repères utiles, calculés
depuis les valeurs de B.4 : le saut de SORIO monte de **213 px (3,3 tuiles)**
et porte à **303 px (4,7 tuiles)** horizontalement.

---

## Ajouter un mini-jeu *(à partir de la passe 9)*

Hériter de `MinigameBase`, qui fournit déjà le compte à rebours, le score, la
récompense, l'écran de règles de 3 s et le pictogramme animé. Le mini-jeu
n'implémente que sa logique propre.

---

## Ajouter une traduction

Tout texte affiché passe par `tr("CLE")`. Une clé sans entrée dans
`translations/sorio.csv` s'affiche telle quelle, en majuscules — c'est visible
immédiatement, donc c'est voulu.

Après modification du CSV :

```bash
$GODOT --headless --path . --import
```
