// Étape 7 — découpage de l'export en morceaux (un par plan) et empreintes (Node).
// Après une modification, seuls les plans dont l'image change doivent être réencodés.
// Lancer : node tests/drama/step7.segments.test.mjs
import { parseScript } from '../../atelier/drama/js/parser.js';
import { computeTiming } from '../../atelier/drama/js/voices.js';
import { buildTimeline, videoSegments } from '../../atelier/drama/js/montage.js';
import { SCRIPT_5_PLANS, CHARACTERS } from './fixtures.mjs';
import { check, done } from './helpers.mjs';

const a = parseScript(SCRIPT_5_PLANS, CHARACTERS);
const DUR = { 'P2:0': 1.2, 'P3:0': 1.0, 'P4:0': 1.5 };
const SHOTS = { P1: 'i1', P2: 'i2', P3: 'i3', P4: 'i4', P5: 'i5' };
const TAKES = { 'P2:0': { assetId: 'v1' }, 'P3:0': { assetId: 'v2' }, 'P4:0': { assetId: 'v3' } };
const make = ({ durations = DUR, shots = SHOTS, settings = {} } = {}) =>
    buildTimeline({ analysis: a, timing: computeTiming(a, durations, CHARACTERS), shots, takes: TAKES, settings });
const segs = (tl, codec = 'vp9') => videoSegments(tl, codec);
// plans dont le morceau change entre deux montages
const changed = (s1, s2) => s2.filter(x => { const o = s1.find(y => y.planId === x.planId); return !o || o.hash !== x.hash; }).map(x => x.planId).join(',') || 'aucun';

console.log('Étape 7 — morceaux vidéo par plan (5 plans)');
const base = segs(make());
check(base.map(s => s.planId + ':' + s.i0 + '-' + s.i1).join(' ') === 'P1:0-75 P2:75-138 P3:138-195 P4:195-267 P5:267-342', '5 morceaux bout à bout : 75 + 63 + 57 + 72 + 75 images');
check(base.reduce((n, s) => n + s.frames, 0) === 342 && base.every((s, i) => !i || s.i0 === base[i - 1].i1), '342 images au total, sans trou ni chevauchement');
check(changed(base, segs(make())) === 'aucun', 'même montage : aucun morceau à refaire');
check(changed(base, segs(make({ settings: { subSize: 'L' } }))) === 'P2,P3,P4', 'taille des sous-titres : seuls les plans parlés (P2, P3, P4) sont refaits');
check(changed(base, segs(make({ settings: { subtitles: false } }))) === 'P2,P3,P4', 'sous-titres retirés : P2, P3, P4');
check(changed(base, segs(make({ shots: { ...SHOTS, P3: 'i3b' } }))) === 'P3', 'nouvelle image pour P3 (coupe franche après) : seul P3');
check(changed(base, segs(make({ shots: { ...SHOTS, P1: 'i1b' } }))) === 'P1,P2', 'nouvelle image pour P1 : P1 et P2 (son fondu d\'entrée montre la fin de P1)');
check(changed(base, segs(make({ shots: { ...SHOTS, P4: 'i4b' } }))) === 'P4,P5', 'nouvelle image pour P4 : P4 et P5 (fondu au noir)');
check(changed(base, segs(make({ durations: { ...DUR, 'P3:0': 1.4 } }))) === 'P3,P4,P5', 'réplique de P3 plus longue : P3 et les plans suivants (décalés)');
check(changed(base, segs(make(), 'avc1')) === 'P1,P2,P3,P4,P5', 'autre encodeur : tout est refait');

done();
