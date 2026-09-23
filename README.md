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
