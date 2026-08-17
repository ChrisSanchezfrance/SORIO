# Ce qui doit être fait à la main dans l'éditeur Godot

Le projet est écrit intégralement en fichiers texte, sans ouvrir l'éditeur.
Cette page liste les rares points où l'éditeur reste nécessaire, **avec un
contournement pour chacun** afin qu'aucun développement ne s'arrête.

État actuel : **aucune tâche éditeur bloquante.**

---

## 1. Import des atlas de sprites (à partir de la passe 7)

**Quand** : le jour où de vrais dessins remplacent les placeholders.

**Pourquoi l'éditeur** : découper un atlas en `AtlasTexture` et bâtir un
`SpriteFrames` se fait normalement à la souris.

**Procédure**
1. Déposer l'atlas dans `assets/sprites/<catégorie>/`.
2. Onglet *Import* → `Filter: Linear`, `Mipmaps: On`, `Compress: VRAM Compressed`.
3. Réimporter.
4. Créer la ressource `SpriteFrames` et découper les animations.
5. Sauvegarder en `.tres` **au format texte** (jamais `.res` binaire).

**Contournement en attendant** : `src/tools/generate_placeholders.gd` fabrique
une forme colorée étiquetée pour tout ce qui manque, et un `SpriteFrames`
mono-image suffit à jouer. Le jeu est entièrement jouable et validable en
placeholders — c'est une règle du projet, pas une tolérance.

**Alternative sans éditeur** : un atlas à grille régulière peut être découpé
par script (`AtlasTexture` construits en boucle). À écrire en passe 7 si le
volume le justifie.

---

## 2. TileSet du monde 1 (passe 2)

**Quand** : passe 2, construction des niveaux ASCII.

**Pourquoi l'éditeur** : régler les polygones de collision tuile par tuile.

**Contournement retenu** : le `TileSet` est **généré par code** depuis une
description en `.tres`. Les tuiles de SORIO sont des carrés de 64 px avec une
collision rectangulaire pleine, sauf les plateformes traversables (collision
one-way sur le bord supérieur). Un cas aussi régulier ne justifie pas la
souris. **Aucune intervention éditeur prévue.**

---

## 3. Icônes adaptatives Android (passe 12)

**Quand** : préparation de l'APK de release.

**Pourquoi l'éditeur** : rien, en réalité. Les icônes sont des PNG déposés
dans `assets/ui/android/` et référencés par `export_presets.cfg`.

**Procédure** : voir `docs/EXPORT_ANDROID.md`.

---

## 4. Vérification visuelle

L'éditeur n'est **jamais** nécessaire pour voir le jeu. Utiliser :

```bash
xvfb-run -a $GODOT --path . --resolution 1280x720 \
  res://src/tools/screenshot.tscn -- \
  --scene=res://src/scenes/title/title.tscn --out=build/title.png
```

Cet outil charge n'importe quelle scène, laisse passer 30 frames pour que les
animations et les `Tween` se placent, et écrit un PNG.
