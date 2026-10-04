// Étape 3 — prompt d'image et empreinte de cache par plan (Node, sans navigateur).
// Lancer : node tests/drama/step3.prompt.test.mjs
import { parseScript } from '../../atelier/drama/js/parser.js';
import { buildImageRequest, MAX_REFS } from '../../atelier/drama/js/images.js';
import { SCRIPT_5_PLANS } from './fixtures.mjs';
import { check, done } from './helpers.mjs';

const project = {
    style: { text: 'manhwa dramatique, couleurs froides, néons', negative: 'texte, 3D', refImageId: 'a-style', locked: true },
    imageSettings: { model: 'agnes-image-2.1-flash', size: '2K', refs: 'all' }
};
const chars = [
    { name: 'Lina', desc: 'Femme de 28 ans, carré noir, yeux verts, trench beige', refImageId: 'a-lina', voice: { speed: 1 } },
    { name: 'Marc', desc: 'Homme de 30 ans, blouson de cuir.', refImageId: 'a-marc', voice: { speed: 1 } }
];
const { plans } = parseScript(SCRIPT_5_PLANS, chars);
const reqs = plans.map(p => buildImageRequest(project, chars, p));

console.log('Étape 3 — prompt et cache des images (5 plans)');
check(reqs.length === 5 && reqs.every(r => r.model === 'agnes-image-2.1-flash' && r.size === '2K' && r.ratio === '9:16'), '5 demandes : modèle 2.1 Flash, 2K, 9:16');

const [r1, r2, r3, r4, r5] = reqs;
check(r1.prompt.startsWith('Vertical 9:16 illustration'), 'prompt : format vertical 9:16 en tête');
check(r1.prompt.includes('Art style, identical for the whole series: manhwa dramatique, couleurs froides, néons.'), 'prompt : style verrouillé de la série');
check(r1.prompt.includes("Setting: Toit d'immeuble, nuit, pluie."), 'prompt : décor du plan');
check(r1.prompt.includes('- Lina: Femme de 28 ans, carré noir, yeux verts, trench beige — same face, hair and outfit as reference image 1.'), 'prompt : fiche de Lina liée à sa photo (image 1)');
check(r1.prompt.includes('Scene: Lina seule au bord du toit, ville néon en contrebas.'), 'prompt : description [IMAGE]');
check(r1.prompt.includes('reference image 2 (style only'), 'prompt : image de style en référence 2');
check(/No text, letters, captions, subtitles, speech bubbles, watermark or logo\. Avoid: texte, 3D\.$/.test(r1.prompt), 'prompt : pas de texte dans l\'image + « à éviter » de la série');
check(/bottom fifth free/.test(r1.prompt), 'prompt : bas de l\'image libre pour les sous-titres');
check(JSON.stringify(r1.refs.map(r => r.assetId)) === '["a-lina","a-style"]', 'P1 : références = photo de Lina + image de style');
check(JSON.stringify(r2.refs.map(r => r.assetId)) === '["a-lina","a-marc","a-style"]' && r2.prompt.includes('- Marc: Homme de 30 ans, blouson de cuir — same face'), 'P2 : Lina + Marc + style, point final de la fiche non doublé');
check(r4.refs.length === 2 && r4.refs[0].name === 'Marc' && !r4.prompt.includes('- Lina'), 'P4 : seul Marc est à l\'image (sa réplique ne compte pas pour Lina)');
check(new Set(reqs.map(r => r.hash)).size === 5, '5 empreintes différentes');

// Empreinte stable, et sensible à tout ce qui change l'image
const again = buildImageRequest(project, chars, plans[0]);
check(again.hash === r1.hash && again.prompt === r1.prompt, 'même plan, mêmes fiches : même empreinte (image reprise du cache)');
const changed = (label, h) => check(h !== r1.hash, 'empreinte modifiée si ' + label);
changed('le style change', buildImageRequest({ ...project, style: { ...project.style, text: 'aquarelle' } }, chars, plans[0]).hash);
changed('la fiche de Lina change', buildImageRequest(project, [{ ...chars[0], desc: 'Femme rousse' }, chars[1]], plans[0]).hash);
changed('la photo de Lina change', buildImageRequest(project, [{ ...chars[0], refImageId: 'a-lina-2' }, chars[1]], plans[0]).hash);
changed('le modèle change', buildImageRequest(project, chars, plans[0], { model: 'agnes-image-2.5-flash' }).hash);
changed('la qualité change', buildImageRequest(project, chars, plans[0], { size: '1K' }).hash);
changed('le texte [IMAGE] change', buildImageRequest(project, chars, { ...plans[0], image: 'Lina sous un parapluie' }).hash);
check(buildImageRequest(project, chars, plans[0], { refs: 'all' }).hash === r1.hash, 'réglage identique à celui de la série : empreinte inchangée');
// Après export/import, les images ont de nouveaux identifiants mais la même clé stable
const imported = buildImageRequest({ ...project, style: { ...project.style, refImageId: 'b-style' } },
    [{ ...chars[0], refImageId: 'b-lina' }, chars[1]], plans[0], {}, { 'b-style': 'a-style', 'b-lina': 'a-lina' });
check(imported.hash === r1.hash && imported.refs[0].assetId === 'b-lina', 'série importée (nouveaux identifiants, mêmes clés) : même empreinte, images reprises');
check(buildImageRequest(project, [chars[0], { ...chars[1], voice: { speed: 1.2 } }], plans[0]).hash === r1.hash, 'la voix de Marc ne change pas l\'image de P1');

// Modes de références
const onlyChars = buildImageRequest(project, chars, plans[1], { refs: 'characters' });
check(onlyChars.refs.every(r => r.role === 'character') && !/style only/.test(onlyChars.prompt), 'mode « personnages seulement » : pas d\'image de style');
const none = buildImageRequest(project, chars, plans[1], { refs: 'none' });
check(none.refs.length === 0 && !/reference image/.test(none.prompt) && none.prompt.includes('- Lina: Femme de 28 ans'), 'mode « aucune » : texte seul, fiches toujours décrites');

// Limites et cas particuliers
const many = Array.from({ length: 6 }, (_, i) => ({ name: 'P' + i, desc: '', refImageId: 'a' + i }));
const big = buildImageRequest(project, many, { id: 'P9', persos: many.map(c => c.name), decor: '', image: 'Foule' });
check(big.refs.length === MAX_REFS && MAX_REFS === 4, 'au plus 4 images de référence par plan');
const noRef = buildImageRequest({ style: { text: '', negative: '' } }, [{ name: 'Lina', desc: '' }], { id: 'P1', persos: ['Lina'], decor: '', image: '@Lina court.' });
check(noRef.prompt.includes('Scene: Lina court.') && !noRef.prompt.includes('..') && !/Art style|Setting/.test(noRef.prompt) && noRef.refs.length === 0,
    'sans style ni photo : prompt minimal, @ retiré, pas de point doublé');

done();
