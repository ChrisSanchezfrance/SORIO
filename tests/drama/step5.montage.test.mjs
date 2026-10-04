// Étape 5 — montage : caméra, transitions, sous-titres, musique et baisse sous les voix (Node).
// Lancer : node tests/drama/step5.montage.test.mjs
import { parseScript } from '../../atelier/drama/js/parser.js';
import { computeTiming } from '../../atelier/drama/js/voices.js';
import * as MT from '../../atelier/drama/js/montage.js';
import { SCRIPT_5_PLANS, CHARACTERS } from './fixtures.mjs';
import { check, done } from './helpers.mjs';

const mv = (type, speed = 'normal', intensity = 'normal') => ({ type, speed, intensity });
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
console.log('Étape 5 — montage (5 plans)');

// Caméra
const zin = [0, 0.5, 1].map(p => MT.cameraAt([mv('zoom-in', 'lent')], p));
check(zin[0].z === 1 && near(zin[1].z, 1.035) && near(zin[2].z, 1.07), 'zoom-in lent : 1 → 1,07, régulier (adouci au début et à la fin)');
check(near(MT.cameraAt([mv('zoom-out', 'rapide')], 0).z, 1.2) && MT.cameraAt([mv('zoom-out', 'rapide')], 1).z === 1, 'zoom-out rapide : 1,2 → 1');
const pg0 = MT.cameraAt([mv('pan-gauche')], 0), pg1 = MT.cameraAt([mv('pan-gauche')], 1);
check(pg0.z === 1.12 && pg0.x < 0 && pg1.x > 0 && near(pg1.x, -pg0.x), 'pan gauche : image agrandie (marge), qui glisse vers la droite');
check(MT.cameraAt([mv('pan-droite')], 1).x < 0 && MT.cameraAt([mv('pan-haut')], 1).y > 0 && MT.cameraAt([mv('pan-bas')], 1).y < 0, 'pan droite / haut / bas : sens attendus');
const room = (z, size) => (z - 1) * size / 2;
check([0, 0.3, 0.7, 1].every(p => { const c = MT.cameraAt([mv('pan-droite', 'rapide'), mv('zoom-in')], p); return Math.abs(c.x) <= room(c.z, MT.W) + 0.01; }),
    'l\'image couvre toujours tout le cadre (décalage ≤ marge)');
const sh = [0.1, 0.4, 0.9, 1.7].map(t => MT.cameraAt([mv('tremblement', 'normal', 'fort')], 0.5, t, 3));
check(sh.every(c => Math.abs(c.x) <= 22 && Math.abs(c.y) <= 22 && c.z > 1) && new Set(sh.map(c => c.x)).size === 4, 'tremblement fort : bougé ≤ 22 px, varié');
check(JSON.stringify(MT.cameraAt([mv('tremblement')], 0.5, 1.3, 7)) === JSON.stringify(MT.cameraAt([mv('tremblement')], 0.5, 1.3, 7)), 'tremblement reproductible (même image à l\'export)');
check(JSON.stringify(MT.cameraAt([mv('fixe')], 0.6)) === '{"z":1,"x":0,"y":0}', 'plan fixe : aucune animation');

// Sous-titres
const cues = MT.buildCues([
    { start: 2, duration: 3, perso: 'Lina', text: '« Je ne sais pas. Peut-être que tu as raison, mais je pars ce soir. »',
      words: '« Je ne sais pas. Peut-être que tu as raison, mais je pars ce soir. »'.split(' ').map((w, i) => ({ w, s: i * 0.2, e: i * 0.2 + 0.18 })) }
]);
check(cues.map(c => c.text).join(' | ') === 'Je ne sais pas. | Peut-être que tu as raison, | mais je pars ce soir.', 'sous-titres découpés aux phrases et virgules, guillemets retirés');
check(near(cues[0].start, 2.2) && cues.every((c, i) => !i || c.start >= cues[i - 1].end) && cues.every(c => c.end - c.start >= 0.79), 'sous-titres calés sur les mots, sans chevauchement, 0,8 s minimum');
const noWords = MT.buildCues([{ start: 10, duration: 2, text: 'Tu m\'as menti.', words: null }]);
check(noWords.length === 1 && noWords[0].start === 10 && noWords[0].text === "Tu m'as menti.", 'réplique sans horodatage : sous-titre réparti sur sa durée');
const long = MT.buildCues([{ start: 0, duration: 6, text: 'un deux trois quatre cinq six sept huit neuf dix onze douze', words: null }]);
check(long.length === 2 && long.every(c => c.text.split(' ').length <= 8), 'phrase longue : au plus 8 mots par sous-titre');

// Musique et baisse sous les voix
const ducks = MT.duckIntervals([{ start: 2, duration: 1 }, { start: 3.2, duration: 1 }, { start: 8, duration: 1 }]);
check(JSON.stringify(ducks) === '[{"start":1.88,"end":4.55},{"start":7.88,"end":9.35}]', 'voix rapprochées : une seule baisse continue');
const env = MT.musicEnvelope({ start: 0, end: 12, volume: 0.5 }, ducks, { musicVolume: 1, duck: 0.2 });
const at = t => MT.envelopeAt(env, t);
check(at(0) === 0 && near(at(0.8), 0.5) && near(at(1.5), 0.5), 'musique : fondu d\'entrée 0,8 s puis volume 50 %');
check(near(at(3), 0.1) && near(at(8.5), 0.1), 'pendant les voix : musique à 20 % de son volume (0,1)');
check(near(at(6), 0.5) && near(at(12), 0) && at(11.6) < 0.5, 'entre les voix : volume normal ; fondu de sortie à la fin');
const late = MT.musicEnvelope({ start: 0, end: 8.9, volume: 0.6 }, [{ start: 6.78, end: 8.75 }], {});
const lateAt = t => MT.envelopeAt(late, t);
check([6.9, 7.5, 8.1, 8.3, 8.4].every(t => lateAt(t) <= 0.12 + 1e-9) && late.filter(p => p.t > 8.1).every(p => p.v < 0.12),
    'voix pendant le fondu de fin : la musique reste basse jusqu\'à la fin, sans remontée');

// Timeline de l'épisode
const a = parseScript(SCRIPT_5_PLANS, CHARACTERS);
const timing = computeTiming(a, { 'P2:0': 1.2, 'P3:0': 1.0, 'P4:0': 1.5 }, CHARACTERS);
const tl = MT.buildTimeline({
    analysis: a, timing,
    shots: { P1: 'i1', P2: 'i2', P3: 'i3', P4: 'i4' },
    takes: { 'P2:0': { assetId: 'v1', words: [{ w: 'Lina,', s: 0, e: 0.5 }, { w: 'attends', s: 0.55, e: 1.0 }, { w: '!', s: 1.0, e: 1.2 }] }, 'P3:0': { assetId: 'v2' }, 'P4:0': { assetId: 'v3' } },
    library: { music: { tension: { assetId: 'm1', duration: 30 } }, sfx: { tonnerre: { assetId: 's1', duration: 2 } } },
    settings: { subSize: 'L' }
});
check(tl.width === 1080 && tl.height === 1920 && tl.fps === 30 && tl.duration === 11.4, 'timeline 1080×1920, 30 i/s, 11,4 s');
check(JSON.stringify(tl.plans.map(p => [p.id, p.start, p.end])) === '[["P1",0,2.5],["P2",2.5,4.6],["P3",4.6,6.5],["P4",6.5,8.9],["P5",8.9,11.4]]', 'plans placés bout à bout');
check(tl.plans[1].transition.type === 'fondu' && tl.plans[4].transition.type === 'fondu-noir' && tl.plans[1].transition.duration === 0.5, 'transitions : fondu (P2), fondu au noir (P5)');
check(JSON.stringify(tl.voices.map(v => [v.lineId, v.start])) === '[["P2:0",2.9],["P3:0",5],["P4:0",6.9]]', 'voix placées dans leurs plans');
check(JSON.stringify(tl.sfx.map(x => [x.name, x.start, x.assetId])) === '[["porte-claque",2.7,null],["tonnerre",8.9,"s1"]]', 'bruitages placés (porte-claque à 2,5 + 0,2 s)');
check(JSON.stringify(tl.music) === '[{"track":"tension","label":"tension","start":0,"volume":0.6,"end":8.9,"assetId":"m1"}]', 'musique « tension » de 0 à 8,9 s (stop en P5)');
check(tl.cues.length === 3 && tl.cues[0].text === 'Lina, attends !' && near(tl.cues[0].start, 2.9) && tl.settings.subSize === 'L', 'sous-titres des 3 répliques, taille choisie');
check(JSON.stringify(tl.missing) === '{"images":["P5"],"voices":[],"music":[],"sfx":["porte-claque"]}', 'éléments manquants repérés (image P5, bruitage porte-claque)');
check(MT.planIndexAt(tl, 0) === 0 && MT.planIndexAt(tl, 2.5) === 1 && MT.planIndexAt(tl, 11.4) === 4 && MT.cueAt(tl, 3.5).perso === 'Marc' && MT.cueAt(tl, 4.4) === null,
    'plan et sous-titre affichés à un instant donné');
check(MT.buildTimeline({ analysis: a, timing, settings: { subtitles: false } }).cues.length === 0, 'sous-titres désactivés : aucun');
const req = MT.requiredSounds(a);
check(JSON.stringify(req) === '{"music":[{"name":"tension","label":"tension"}],"sfx":[{"name":"porte-claque","label":"porte-claque"},{"name":"tonnerre","label":"tonnerre"}]}', 'sons à importer : tension, porte-claque, tonnerre');

done();
