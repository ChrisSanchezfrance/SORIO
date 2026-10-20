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

# Style Forge v5 — Studio Réalisateur

Deuxième application, elle aussi en **un seul fichier** : `style-forge.html`. À partir d'une photo de
référence, elle génère des séries de 20 à 60 images (même visage, univers variés) via l'API image Agnes AI.

- **12 modes studio** et 126 esthétiques : cinéma, grands photographes, Studio Harcourt, haute couture,
  beaux-arts, street art, affiches, BD, manga, hyperréalisme, hyper-illustration, visuels d'abonnement.
- **Branches** : chaque image peut être développée (variantes, duo, décor seul, plans « Cinéma IA »,
  prompt libre) ; c'est toujours l'image générée qui sert de source.
- **Plusieurs clés API** avec rotation automatique et cooldown sur les 429, workers parallèles.
- Sélection multiple et téléchargement en lot, historique, sessions et images sauvegardées dans
  IndexedDB, panneau Admin (prompts, textes, API, import/export des esthétiques).

Ouvrez `style-forge.html` dans un navigateur, collez une ou plusieurs clés `sk-…`, chargez une photo
et touchez **FORGER LA SÉRIE**.
