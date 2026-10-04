// Étape 2 — parseur : script balisé → plans JSON (Node, sans navigateur).
// Lancer : node tests/drama/step2.parser.test.mjs
import { parseScript, DEFAULT_PLAN_SECONDS } from '../../atelier/drama/js/parser.js';
import { SCRIPT_5_PLANS, CHARACTERS } from './fixtures.mjs';
import { check, done } from './helpers.mjs';

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('Étape 2 — parseur (test sur 5 plans)');
const r = parseScript(SCRIPT_5_PLANS, CHARACTERS);

check(r.ok && r.errors.length === 0, 'script de 5 plans valide, 0 erreur' + (r.errors.length ? ' ' + JSON.stringify(r.errors) : ''));
check(r.warnings.length === 0, '0 avertissement' + (r.warnings.length ? ' ' + JSON.stringify(r.warnings) : ''));
check(r.plans.length === 5 && eq(r.plans.map(p => p.id), ['P1', 'P2', 'P3', 'P4', 'P5']), '5 plans P1 à P5');
check(eq(r.plans.map(p => p.line), [1, 8, 16, 23, 30]), 'numéros de ligne de chaque [PLAN]');

const [p1, p2, p3, p4, p5] = r.plans;
check(p1.decor === 'Toit d\'immeuble, nuit, pluie' && !p1.decorInherited, 'P1 : décor');
check(eq(p2.persos, ['Lina', 'Marc']) && eq(p3.persos, ['Lina']), 'PERSOS résolus vers les fiches');
check(p3.image === 'Gros plan sur Lina, larmes et pluie mêlées', 'P3 : texte de l\'image');

check(eq(p1.cam.moves, [{ type: 'zoom-in', speed: 'lent', intensity: 'normal' }]), 'P1 : zoom-in lent');
check(eq(p2.cam.moves, [{ type: 'pan-gauche', speed: 'normal', intensity: 'normal' }]) && eq(p2.cam.transition, { type: 'fondu', duration: 0.5 }), 'P2 : pan-gauche + transition fondu 0,5 s');
check(eq(p3.cam.moves, [{ type: 'tremblement', speed: 'normal', intensity: 'leger' }]), 'P3 : tremblement léger');
check(p4.cam.moves[0].type === 'zoom-out' && p4.cam.moves[0].speed === 'lent', 'P4 : zoom-out lent');
check(p5.cam.moves[0].type === 'fixe' && eq(p5.cam.transition, { type: 'fondu-noir', duration: 0.5 }), 'P5 : fixe + fondu au noir');

check(eq(p2.voix.map(v => [v.perso, v.ton, v.texte]), [['Marc', null, 'Lina, attends !']]), 'P2 : réplique de Marc (guillemets retirés)');
check(eq(p4.voix.map(v => [v.perso, v.ton, v.texte]), [['Marc', 'chuchoté', 'Je voulais te protéger.']]), 'P4 : ton « chuchoté » extrait');
check(eq(p2.sfx.map(s => [s.name, s.at, s.volume]), [['porte-claque', 0.2, 1]]) && eq(p5.sfx.map(s => [s.name, s.at]), [['tonnerre', 0]]), 'SFX : nom + moment');

check(eq(r.plans.map(p => [p.musique.action, p.musique.track]),
    [['start', 'tension'], ['continue', 'tension'], ['continue', 'tension'], ['continue', 'tension'], ['stop', null]]),
    'MUSIQUE : tension démarre en P1, continue, s\'arrête en P5');

check(eq(r.plans.map(p => p.duration.mode), ['default', 'audio', 'audio', 'audio', 'default']), 'durée : 2,5 s par défaut sans réplique, sinon audio');
check(p1.duration.seconds === DEFAULT_PLAN_SECONDS && p1.duration.seconds === 2.5, 'P1 sans réplique = 2,5 s');
check(p2.duration.seconds === null && p2.duration.estimate > 1.4 && p2.duration.estimate < 4, 'P2 : durée audio à venir, estimation ' + p2.duration.estimate + ' s');
check(r.stats.plans === 5 && r.stats.voix === 3 && r.stats.sfx === 2 && eq(r.stats.characters, ['Lina', 'Marc']) && eq(r.stats.tracks, ['tension']),
    'statistiques : 5 plans, 3 répliques, 2 sons, 2 personnages, 1 piste');
check(r.stats.estimatedSeconds > 10 && r.stats.estimatedSeconds < 20, 'durée estimée de l\'épisode : ' + r.stats.estimatedSeconds + ' s');
check(eq(JSON.parse(JSON.stringify(r)), r), 'résultat entièrement sérialisable en JSON');
check(parseScript(SCRIPT_5_PLANS, CHARACTERS).hash === r.hash && parseScript(SCRIPT_5_PLANS + ' ', CHARACTERS).hash !== r.hash, 'empreinte stable, change si le script change');

// Variantes de syntaxe tolérées
const v = parseScript(`# commentaire
[plan]
[Décor] Rue
[persos] @lina, @MARC
[IMAGE] Lina et Marc courent
sous la pluie battante
[CAM] Zoom avant rapide + secousse forte ; transition: fondu au blanc 1,2s ; durée: 4s
[VOIX] @marc: “Plus vite !”
[SFX] Pas dans les flaques @0,5s vol: 0.4
[MUSIQUE] Poursuite vol: 0.3

[PLAN]
[IMAGE] Gros plan sur @Lina
[MUSIQUE] continue`, CHARACTERS);
check(v.ok, 'variantes : minuscules, accents, virgules décimales, alias de balises' + (v.errors.length ? ' ' + JSON.stringify(v.errors) : ''));
check(v.plans[0].number === 1 && v.plans[1].number === 2, 'numérotation automatique sans numéro');
check(eq(v.plans[0].persos, ['Lina', 'Marc']), 'casse des @Nom normalisée');
check(v.plans[0].image === 'Lina et Marc courent sous la pluie battante', 'IMAGE sur deux lignes');
check(eq(v.plans[0].cam.moves.map(m => [m.type, m.speed, m.intensity]), [['zoom-in', 'rapide', 'normal'], ['tremblement', 'normal', 'fort']]), 'synonymes : zoom avant, secousse');
check(eq(v.plans[0].cam.transition, { type: 'fondu-blanc', duration: 1.2 }) && v.plans[0].duration.mode === 'fixed' && v.plans[0].duration.seconds === 4, 'fondu au blanc 1,2 s + durée imposée 4 s');
check(v.plans[0].voix[0].texte === 'Plus vite !' && eq([v.plans[0].sfx[0].name, v.plans[0].sfx[0].at, v.plans[0].sfx[0].volume], ['pas-dans-les-flaques', 0.5, 0.4]), 'guillemets “ ” et SFX avec volume');
check(v.plans[1].decor === 'Rue' && v.plans[1].decorInherited && eq(v.plans[1].persos, ['Lina']), 'décor hérité ; @Lina cité dans IMAGE ajouté aux PERSOS');
check(v.warnings.some(w => w.line === 13 && /ajouté/.test(w.message)), 'avertissement ligne 13 pour l\'ajout de @Lina');
check(v.plans[1].musique.action === 'continue' && v.plans[1].musique.track === 'poursuite' && v.plans[1].musique.volume === 0.3, 'musique qui continue avec son volume');

// Erreurs avec numéros de ligne
const bad = parseScript(`Bonjour
[PLAN] 1
[DECOR] Salon
[PERSOS] @Lina @Paul Marc
[IMAGE] Lina regarde la fenêtre
[CAM] zoom-inn lent ; transition: fonduu ; duree: 99s
[VOIX] Lina: Salut
[VOIX] @Lina:
[SFXX] boum
[IMAGE] deuxième image

[PLAN] 1
[DECOR] Cuisine
[CAM] zoom-in + zoom-out
[MUSIQUE] stop
oups`, CHARACTERS);
const at = (line, re) => bad.errors.some(e => e.line === line && re.test(e.message));
check(!bad.ok, 'script fautif rejeté (' + bad.errors.length + ' erreurs)');
check(at(1, /avant le premier \[PLAN\]/), 'ligne 1 : texte avant le premier [PLAN]');
check(at(4, /@Paul inconnu/) && at(4, /« Marc » : écrivez @Marc/), 'ligne 4 : @Paul inconnu, « Marc » sans @');
check(at(6, /zoom-inn.*vouliez-vous « zoom-in »/) && at(6, /fonduu.*vouliez-vous « fondu »/) && at(6, /entre 0,5 et 60 s/), 'ligne 6 : mouvement, transition (avec suggestion) et durée invalides');
check(at(7, /@Nom: « texte »/) && at(8, /Réplique vide/), 'lignes 7-8 : réplique sans @ et réplique vide');
check(at(9, /\[SFXX\].*vouliez-vous \[SFX\]/) && at(10, /\[IMAGE\] déjà présent/), 'lignes 9-10 : balise inconnue (suggestion) et IMAGE en double');
check(at(12, /déjà utilisé/) && at(12, /sans \[IMAGE\]/) && at(14, /zoom-in et zoom-out/) && at(16, /sans balise/), 'lignes 12-16 : numéro en double, plan sans image, zooms contradictoires, ligne orpheline');
check(bad.errors.every((e, i, a) => !i || a[i - 1].line <= e.line), 'erreurs triées par ligne');
check(parseScript('# idée\nquelque chose', CHARACTERS).errors.some(e => e.message === 'Texte avant le premier [PLAN]'), 'script sans [PLAN] : erreur');
check(parseScript('# juste un commentaire', CHARACTERS).errors[0].message === 'Aucun [PLAN] dans le script', 'commentaires seuls : « Aucun [PLAN] »');
const empty = parseScript('  \n', CHARACTERS);
check(!empty.ok && empty.errors.length === 0 && empty.plans.length === 0, 'script vide : ni plan ni erreur (brouillon)');

done();
