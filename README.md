# SORIO — Cartoon Factory

Application web en **un seul fichier** (`index.html`) qui transforme vos photos en courtes vidéos
de dessin animé (format portrait 9:16), via l'API vidéo Agnes AI.

## Utilisation

1. Ouvrez `index.html` dans un navigateur récent (mobile ou ordinateur).
2. Collez votre clé API (gratuite sur [platform.agnes-ai.com](https://platform.agnes-ai.com) → Settings → API Keys).
3. Ajoutez une ou plusieurs photos, choisissez un des 38 styles cartoon, ajoutez éventuellement des détails.
4. Touchez **Créer**. Les vidéos apparaissent dans la galerie au fur et à mesure.

La clé API est stockée uniquement dans le `localStorage` du navigateur.
Les créations sont espacées d'environ 62 s pour respecter les limites de l'API.

---

# Atelier Vidéo (`atelier/`)

Application installable sur Android (PWA) qui prolonge vos images en vidéos portrait 9:16, via la même API Agnes AI.

- **Votre vision** : un texte appliqué à toutes les images. Une réplique entre « … » fait parler le personnage,
  `@Nom` appelle une fiche personnage.
- **Personnages** : fiches (nom, description, photo) gardées sur le téléphone ; « Animer sa photo » l'ajoute aux images.
- **Effets** : 424 effets (12 ambiances rapides, 12 transformations rapides, catalogue n° 1 à 400) avec recherche ;
  jusqu'à 3 combinés. Les n° 40 et 292 tirent un effet au hasard pour chaque image.
- **Réglages** : durée (5 / 6,4 / 10 s), cadrage, intensité du mouvement.

## Installer sur Android

L'installation demande que le dossier `atelier/` soit servi en HTTPS (par exemple GitHub Pages) :

1. Ouvrez l'adresse du dossier `atelier/` dans Chrome sur Android.
2. Touchez **📲 Installer l'application** (ou menu ⋮ → « Ajouter à l'écran d'accueil »).
3. L'appli s'ouvre alors en plein écran depuis son icône, comme une application normale.
