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

# Atelier Vidéo — appli mobile (`atelier/`)

Le dossier `atelier/` contient **Atelier Vidéo** (vos images prolongées en vidéo, portrait 9:16, 424 effets,
personnages @Nom, répliques), à l'identique, transformé en **application installable sur le téléphone** (PWA).

Adresse une fois GitHub Pages activé : **https://chrissanchezfrance.github.io/SORIO/atelier/**

## Installer sur le téléphone

- **Android (Chrome)** : ouvrez l'adresse, touchez **Installer** dans le panneau du haut
  (ou menu ⋮ → « Installer l'application »). L'icône apparaît sur l'écran d'accueil, l'appli s'ouvre en plein écran.
- **iPhone (Safari)** : ouvrez l'adresse, bouton **Partager** ⬆️ → « Sur l'écran d'accueil ».

## Ajouts pour l'usage au quotidien

- **Accès à la galerie** : « Ajoutez vos images » et « Choisir une photo » (personnages) ouvrent la galerie
  du téléphone (ou l'appareil photo), sélection multiple possible.
- **Écran qui reste allumé** : bouton « Garder l'écran allumé » (Wake Lock + repli vidéo pour iPhone),
  réactivé automatiquement au retour dans l'appli et pendant la génération.
- **Enregistrement des vidéos** : chaque vidéo terminée est gardée dans l'appli (section « Mes vidéos
  enregistrées », conservée après fermeture). « 💾 Enregistrer » la copie sur le téléphone : feuille de partage
  → « Enregistrer la vidéo » (galerie Photos sur iPhone) ou téléchargement (Téléchargements / Galerie sur Android).
  Option « Copier automatiquement » (activée par défaut sur Android) et « Tout copier sur le téléphone ».
- **Pause en arrière-plan** : quand l'appli passe en arrière-plan ou que l'écran se verrouille, tout se met en
  pause (comptes à rebours, envoi de l'image suivante, lecture des vidéos) et reprend au retour.
  Les vidéos déjà envoyées sont mémorisées : si le téléphone ferme l'appli, elles sont **récupérées
  automatiquement** à la prochaine ouverture (jusqu'à 24 h).
- **Format** (onglet « 📐 Format ») : Vertical 9:16 par défaut, YouTube (vidéo 16:9, Shorts 9:16), TikTok 9:16,
  Instagram (Reels/Story 9:16, publication 4:5, carrée 1:1), Facebook (Reels/Story 9:16, publication 4:5, carrée 1:1,
  vidéo paysage 16:9), Snapchat 9:16, Télé (HD 16:9, ancienne télé 4:3, cinéma 21:9). Chaque image est préparée aux
  bonnes proportions avant l'envoi : recadrée au centre, ou complétée d'un fond flou pour ne rien couper, ou laissée
  telle quelle. Le choix est mémorisé.
- **Hors ligne** : l'appli s'ouvre même sans réseau (la création de vidéos, elle, demande Internet).

---

# Drama — séries en images animées et doublées (onglet « 🎬 Drama »)

Drama est un **onglet de l'appli Atelier Vidéo** : en haut de l'appli, « 🎞️ Vidéos | 🎬 Drama ».
Il se présente comme l'onglet Vidéos : un panneau en haut (série en cours, clés), puis des sections repliables.
Cible : Android / Chrome. Code : `atelier/drama/`.

| Étape | Section de l'onglet | Contenu | État |
|---|---|---|---|
| 1 | 🎨 Style · 🎭 Personnages · 📺 Épisodes · 💾 Sauvegarde | Série au style verrouillable (description, à éviter, image de référence), fiches @Nom (photo de référence, voix ElevenLabs + réglages), épisodes numérotés, export/import | ✅ |
| 2 | 📝 Script | Script balisé `[PLAN] [DECOR] [PERSOS] [IMAGE] [CAM] [VOIX] [SFX] [MUSIQUE]` → plans JSON : analyse en direct, erreurs par ligne avec suggestions, 2,5 s par défaut sans réplique (`duree: Ns` dans [CAM]) | ✅ |
| 3 | 🖼️ Images des plans | Une image 9:16 par plan avec Agnes (`agnes-image-2.1-flash`, 2K) : prompt = style + décor + fiches + [IMAGE], photos des personnages et image de style en références ; cache par empreinte, régénération d'un plan seul, 4 versions gardées, reprises automatiques (429, réseau), repli base64, pause en arrière-plan | ✅ |
| 4 | 🎙️ Voix et durées | Doublage ElevenLabs : une prise par réplique avec la voix et les réglages de la fiche, horodatage des mots (pour les sous-titres) ; durée du plan = 0,4 s + répliques (0,35 s entre elles) + 0,5 s, 2,5 s sans réplique ; cache, « autre prise », 4 versions, écoute de l'épisode, reprises (429, réseau), crédits épuisés signalés, pause en arrière-plan | ✅ |
| 5 | 🎞️ Montage | Aperçu en temps réel (9:16) : zoom, panoramiques, tremblement, transitions (fondu, fondu au noir/blanc, glissés, flash), sous-titres incrustés calés sur les mots (3 tailles) ; mixage voix + bruitages + musique en boucle avec fondus et baisse sous les voix ; bibliothèque sonore de la série (musiques et bruitages importés, appelés par leur nom dans le script) | ✅ |
| 6 | 📤 Export | MP4 1080×1920, 30 i/s, son stéréo 48 kHz, fabriqué sur le téléphone (WebCodecs + mp4-muxer, écrit au fil de l'eau dans le stockage privé) : H.264 + AAC si l'appareil les produit, sinon VP9/AV1 + Opus ; progression et temps restant, pause en arrière-plan, arrêt sans fichier incomplet, export « à refaire » si le montage change ; vignette « EP.x » 1080×1920 tirée du plan choisi ; enregistrement sur le téléphone | ✅ |
| 7 | 🗂️ Rendu en lot | Export plan par plan : chaque plan encodé est gardé, seuls les plans manquants ou modifiés sont refaits (arrêt, coupure, petite modification), puis assemblage du MP4 sans réencodage ; lot de plusieurs épisodes avec file gardée sur le téléphone, second essai automatique en cas d'erreur, « Reprendre » après fermeture de l'appli | ✅ |

Clés : Agnes = celle de l'onglet Vidéos (partagée) ; ElevenLabs = saisie dans le panneau du haut de l'onglet Drama.
Les données (séries, photos, scripts, images générées) restent sur le téléphone (IndexedDB).

Code : `js/db.js` (IndexedDB), `js/model.js` (règles métier), `js/parser.js` (script → plans, pur),
`js/images.js` (prompt, cache et génération des images), `js/voices.js` (doublage et minutage), `js/jobs.js` (pause, reprises),
`js/montage.js` (timeline, caméra, sous-titres, musique — pur), `js/render.js` (dessin d'une image), `js/mix.js` (mixage), `js/player.js` (aperçu), `js/export.js` (MP4 par morceaux et vignette), `js/batch.js` (lot et reprise), `vendor/mp4-muxer.mjs` (MIT),
`js/agnes.js` / `js/elevenlabs.js` (API), `js/app.js` (onglet).

Tests (Chromium via Playwright, API simulées ; `node <fichier>`) :
`tests/drama/step1.test.mjs`, `step2.parser.test.mjs` (Node seul), `step2.ui.test.mjs`,
`step3.prompt.test.mjs` (Node seul), `step3.images.test.mjs`, `step4.timing.test.mjs` (Node seul), `step4.voices.test.mjs`, `step5.montage.test.mjs` (Node seul), `step5.preview.test.mjs`, `step6.export.test.mjs` (relit le MP4 produit), `step7.segments.test.mjs` (Node seul), `step7.batch.test.mjs`,
et `tests/atelier/videos.test.mjs` (onglet Vidéos).
