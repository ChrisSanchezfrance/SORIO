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
