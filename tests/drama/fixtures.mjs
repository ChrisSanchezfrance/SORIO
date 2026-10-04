// Données de test partagées par les étapes Drama.

// Épisode de 5 plans utilisé à chaque étape.
export const SCRIPT_5_PLANS = `[PLAN] 1
[DECOR] Toit d'immeuble, nuit, pluie
[PERSOS] @Lina
[IMAGE] Lina seule au bord du toit, ville néon en contrebas
[CAM] zoom-in lent
[MUSIQUE] tension

[PLAN] 2
[DECOR] Toit d'immeuble, nuit, pluie
[PERSOS] @Lina @Marc
[IMAGE] Marc surgit derrière elle, essoufflé
[CAM] pan-gauche ; transition: fondu
[VOIX] @Marc: « Lina, attends ! »
[SFX] porte-claque @0.2s

[PLAN] 3
[DECOR] Toit d'immeuble, nuit, pluie
[PERSOS] @Lina
[IMAGE] Gros plan sur Lina, larmes et pluie mêlées
[CAM] tremblement léger
[VOIX] @Lina: « Tu m'as menti. »

[PLAN] 4
[DECOR] Toit d'immeuble, nuit, pluie
[PERSOS] @Marc
[IMAGE] Marc baisse les yeux, la main tendue
[CAM] zoom-out lent
[VOIX] @Marc (chuchoté): « Je voulais te protéger. »

[PLAN] 5
[DECOR] Toit d'immeuble, nuit, éclair
[PERSOS] @Lina @Marc
[IMAGE] Un éclair illumine les deux silhouettes face à face
[CAM] fixe ; transition: fondu au noir
[SFX] tonnerre @0.0s
[MUSIQUE] stop
`;


export const CHARACTERS = [
    { name: 'Lina', voice: { voiceId: 'voice_lina', speed: 1 } },
    { name: 'Marc', voice: { voiceId: 'voice_marc', speed: 1 } }
];
