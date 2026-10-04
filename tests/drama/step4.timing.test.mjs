// Étape 4 — empreinte des répliques et minutage de l'épisode (Node, sans navigateur).
// Lancer : node tests/drama/step4.timing.test.mjs
import { parseScript } from '../../atelier/drama/js/parser.js';
import { episodeLines, buildVoiceRequest, computeTiming } from '../../atelier/drama/js/voices.js';
import { alignmentToWords } from '../../atelier/drama/js/elevenlabs.js';
import { SCRIPT_5_PLANS } from './fixtures.mjs';
import { check, done } from './helpers.mjs';

const project = { voiceModel: 'eleven_multilingual_v2' };
const chars = [
    { name: 'Lina', voice: { voiceId: 'voice_lina', voiceName: 'Lina FR', stability: 0.4, similarity: 0.8, style: 0.2, speed: 1 } },
    { name: 'Marc', voice: { voiceId: 'voice_marc', voiceName: 'Marc FR', stability: 0.5, similarity: 0.75, style: 0, speed: 1.1 } }
];
const a = parseScript(SCRIPT_5_PLANS, chars);
const lines = episodeLines(a);

console.log('Étape 4 — répliques et minutage (5 plans)');
check(lines.map(l => l.id + '=' + l.perso).join(' ') === 'P2:0=Marc P3:0=Lina P4:0=Marc', '3 répliques : P2 Marc, P3 Lina, P4 Marc');
const r = lines.map(l => buildVoiceRequest(project, chars, l));
check(r[0].voiceId === 'voice_marc' && r[0].modelId === 'eleven_multilingual_v2' && r[0].text === 'Lina, attends !' &&
    JSON.stringify(r[0].settings) === '{"stability":0.5,"similarity":0.75,"style":0,"speed":1.1}', 'P2 : voix, modèle, texte et réglages de la fiche de Marc');
check(r[2].text === 'Je voulais te protéger.' && lines[2].ton === 'chuchoté', 'P4 : ton « chuchoté » gardé à part, texte sans guillemets');

// Empreinte
const h = (proj, cs, line) => buildVoiceRequest(proj, cs, line).hash;
check(new Set(r.map(x => x.hash)).size === 3 && h(project, chars, lines[0]) === r[0].hash, 'empreintes distinctes et stables');
check(h(project, chars, { ...lines[0], ton: 'crié' }) === r[0].hash, 'changer le ton seul ne refait pas la prise (il n\'est pas envoyé)');
check(h(project, chars, { ...lines[0], texte: 'Lina, attends-moi !' }) !== r[0].hash, 'texte modifié : nouvelle prise');
check(h({ voiceModel: 'eleven_turbo_v2_5' }, chars, lines[0]) !== r[0].hash, 'modèle modifié : nouvelle prise');
const marc2 = [chars[0], { ...chars[1], voice: { ...chars[1].voice, speed: 1 } }];
check(h(project, marc2, lines[0]) !== r[0].hash && h(project, marc2, lines[1]) === r[1].hash, 'vitesse de Marc modifiée : ses répliques changent, pas celles de Lina');
check(h(project, [chars[0], { ...chars[1], voice: { ...chars[1].voice, voiceId: 'voice_x' } }], lines[0]) !== r[0].hash, 'voix modifiée : nouvelle prise');
check(/Choisissez une voix pour @Marc/.test(buildVoiceRequest(project, [chars[0], { name: 'Marc', voice: {} }], lines[0]).error), 'fiche sans voix : message clair');
check(buildVoiceRequest({}, chars, lines[1]).modelId === 'eleven_multilingual_v2', 'modèle par défaut : Multilingual v2');

// Minutage
const est = computeTiming(a, {}, chars);
check(!est.complete && est.voiced === 0 && est.lines === 3 && est.plans.map(p => p.mode).join() === 'default,estimate,estimate,estimate,default',
    'sans prises : P1 et P5 à 2,5 s, les plans parlés sont estimés');
const t = computeTiming(a, { 'P2:0': 1.2, 'P3:0': 1.0, 'P4:0': 1.5 }, chars);
check(t.complete && t.plans.map(p => p.mode).join() === 'default,audio,audio,audio,default', 'toutes les prises : durées issues de l\'audio');
check(JSON.stringify(t.plans.map(p => p.duration)) === '[2.5,2.1,1.9,2.4,2.5]', 'durées : P2 = 0,4 + 1,2 + 0,5 = 2,1 s, P3 = 1,9 s, P4 = 2,4 s');
check(JSON.stringify(t.plans.map(p => p.start)) === '[0,2.5,4.6,6.5,8.9]' && t.total === 11.4, 'enchaînement des plans, total 11,4 s');
check(t.plans[1].lines[0].start === 0.4 && t.plans[1].lines[0].duration === 1.2, 'réplique de P2 placée à 0,4 s du début du plan');

const two = parseScript('[PLAN] 1\n[PERSOS] @Lina @Marc\n[IMAGE] Dispute\n[VOIX] @Lina: « Non. »\n[VOIX] @Marc: « Si. »\n\n[PLAN] 2\n[IMAGE] Silence\n[CAM] fixe ; duree: 1s\n[VOIX] @Lina: « Bien sûr que non, jamais. »', chars);
const t2 = computeTiming(two, { 'P1:0': 0.6, 'P1:1': 0.5, 'P2:0': 1.8 }, chars);
check(t2.plans[0].duration === 2.35 && t2.plans[0].lines[1].start === 1.35, 'deux répliques : 0,4 + 0,6 + 0,35 + 0,5 + 0,5 = 2,35 s, la 2e à 1,35 s');
check(t2.plans[1].duration === 1 && t2.plans[1].mode === 'fixed' && t2.plans[1].overflow, 'durée imposée plus courte que la voix : signalée');
const short = computeTiming(parseScript('[PLAN] 1\n[PERSOS] @Lina\n[IMAGE] Regard\n[VOIX] @Lina: « Oh. »', chars), { 'P1:0': 0.3 }, chars);
check(short.plans[0].duration === 1.5, 'plan très court : 1,5 s minimum');

// Mots horodatés (sous-titres de l'étape 5)
const words = alignmentToWords({
    characters: [...'Tu m\'as menti.'],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3]
});
check(JSON.stringify(words) === '[{"w":"Tu","s":0,"e":0.2},{"w":"m\'as","s":0.3,"e":0.6},{"w":"menti.","s":0.7,"e":1.3}]', 'alignement → mots horodatés : Tu / m\'as / menti.');
check(alignmentToWords(null).length === 0, 'sans alignement : aucun mot (durée lue sur l\'audio)');

done();
