// Drama — parseur de script balisé → liste de plans (JSON)
// Module pur (sans DOM) : utilisable dans l'appli et testable directement avec Node.
//
// Syntaxe (une balise par ligne ; une ligne sans balise prolonge la balise précédente) :
//   [PLAN] 12                       numéro facultatif (sinon : précédent + 1), titre libre après le numéro
//   [DECOR] Cuisine, nuit           hérité du plan précédent s'il est absent
//   [PERSOS] @Lina @Marc
//   [IMAGE] Description de l'image  (obligatoire ; les @Nom cités sont ajoutés aux PERSOS)
//   [CAM] zoom-in lent + tremblement léger ; transition: fondu 0.8s ; duree: 4s
//   [VOIX] @Lina (chuchoté): « Réplique. »      plusieurs lignes possibles, dans l'ordre
//   [SFX] porte-claque @1.2s vol: 0.6            plusieurs lignes possibles
//   [MUSIQUE] tension vol: 0.5  |  stop  |  continue
//   # commentaire  ou  // commentaire
//
// Durée d'un plan : « duree: Ns » dans [CAM] si présent ; sinon durée de l'audio des
// répliques (calculée à l'étape 4) ; sinon DEFAULT_PLAN_SECONDS.

export const PARSER_VERSION = 1;
export const DEFAULT_PLAN_SECONDS = 2.5;
export const DEFAULT_TRANSITION_SECONDS = 0.5;
export const EPISODE_TARGET = { min: 180, max: 360 };   // 3 à 6 minutes

// Estimation (avant doublage) : débit parlé et marges autour des répliques.
const WORDS_PER_SECOND = 2.6;
const GAP_BETWEEN_LINES = 0.35;
const PLAN_LEAD = 0.4, PLAN_TAIL = 0.5, MIN_VOICED_PLAN = 1.5;

export const TAGS = ['PLAN', 'DECOR', 'PERSOS', 'IMAGE', 'CAM', 'VOIX', 'SFX', 'MUSIQUE'];
const TAG_ALIASES = {
    PLAN: 'PLAN', SHOT: 'PLAN',
    DECOR: 'DECOR', LIEU: 'DECOR',
    PERSOS: 'PERSOS', PERSO: 'PERSOS', PERSONNAGES: 'PERSOS', PERSONNAGE: 'PERSOS',
    IMAGE: 'IMAGE', IMG: 'IMAGE',
    CAM: 'CAM', CAMERA: 'CAM',
    VOIX: 'VOIX', DIALOGUE: 'VOIX',
    SFX: 'SFX', SON: 'SFX', BRUITAGE: 'SFX',
    MUSIQUE: 'MUSIQUE', MUSIC: 'MUSIQUE'
};
const SINGLE_TAGS = ['DECOR', 'PERSOS', 'IMAGE', 'CAM', 'MUSIQUE'];

export const CAMERA_MOVES = {
    'fixe': ['fixe', 'statique', 'fixed', 'static', 'aucun'],
    'zoom-in': ['zoom in', 'zoomin', 'zoom avant', 'push in', 'zoom'],
    'zoom-out': ['zoom out', 'zoomout', 'zoom arriere', 'dezoom', 'pull out', 'pull back'],
    'pan-gauche': ['pan gauche', 'panoramique gauche', 'pan left', 'travelling gauche'],
    'pan-droite': ['pan droite', 'panoramique droite', 'pan right', 'travelling droite'],
    'pan-haut': ['pan haut', 'tilt up', 'tilt haut', 'panoramique haut'],
    'pan-bas': ['pan bas', 'tilt down', 'tilt bas', 'panoramique bas'],
    'tremblement': ['tremblement', 'tremble', 'shake', 'secousse', 'camera epaule']
};
const SPEEDS = { lent: 'lent', lente: 'lent', doux: 'lent', douce: 'lent', slow: 'lent',
    normal: 'normal', normale: 'normal', rapide: 'rapide', vite: 'rapide', fast: 'rapide' };
const INTENSITIES = { leger: 'leger', legere: 'leger', subtil: 'leger', subtile: 'leger',
    moyen: 'normal', moyenne: 'normal', fort: 'fort', forte: 'fort', violent: 'fort', violente: 'fort' };

export const TRANSITIONS = {
    'coupe': ['coupe', 'cut', 'sec', 'aucune'],
    'fondu': ['fondu', 'fondu enchaine', 'enchaine', 'dissolve', 'crossfade'],
    'fondu-noir': ['fondu au noir', 'fondu noir', 'noir', 'fade black', 'fade to black'],
    'fondu-blanc': ['fondu au blanc', 'fondu blanc', 'blanc', 'fade white'],
    'glisse-gauche': ['glisse gauche', 'glissement gauche', 'slide left', 'glisse'],
    'glisse-droite': ['glisse droite', 'glissement droite', 'slide right'],
    'flash': ['flash', 'flash blanc']
};

// ─── Outils ───────────────────────────────────────────────────────
export const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = s => fold(s).replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
export const slug = s => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const num = s => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const round2 = n => Math.round(n * 100) / 100;
const stripQuotes = s => String(s).trim()
    .replace(/^«\s*([\s\S]*?)\s*»$/, '$1').replace(/^“([\s\S]*)”$/, '$1').replace(/^"([\s\S]*)"$/, '$1').trim();

export function hashString(str) {               // FNV-1a 32 bits, en hexadécimal
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
}

function matchSynonym(table, text) {            // plus long synonyme qui commence le texte
    let best = null;
    for (const [key, syns] of Object.entries(table)) {
        for (const syn of [key.replace(/-/g, ' '), ...syns]) {
            if ((text === syn || text.startsWith(syn + ' ')) && (!best || syn.length > best.syn.length)) best = { key, syn };
        }
    }
    return best ? { key: best.key, rest: text.slice(best.syn.length).trim() } : null;
}

function closest(input, options) {              // suggestion pour les fautes de frappe
    const a = words(input);
    let best = null, bestD = Infinity;
    for (const o of options) {
        const b = o.replace(/-/g, ' ');
        const d = levenshtein(a, b);
        if (d < bestD) { bestD = d; best = o; }
    }
    return bestD <= Math.max(2, Math.floor(a.length / 3)) ? best : null;
}
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[n];
}

// ─── Analyse des valeurs de balises ───────────────────────────────
function parseCam(value, report) {
    const cam = { moves: [], transition: { type: 'coupe', duration: 0 }, fixedDuration: null };
    const segments = value.split(';').map(s => s.trim()).filter(Boolean);
    for (const seg of segments) {
        const w = words(seg);
        let m;
        if ((m = /^(?:transition|trans)\s*:?\s*(.*)$/.exec(w))) {
            let rest = m[1].trim();
            let dur = null;
            const d = /\s*([\d.,]+)\s*s?$/.exec(rest);
            if (d && rest.slice(0, d.index).trim()) { dur = num(d[1]); rest = rest.slice(0, d.index).trim(); }
            const t = matchSynonym(TRANSITIONS, rest);
            if (!t || t.rest) {
                const sug = closest(rest, Object.keys(TRANSITIONS));
                report('error', 'Transition inconnue « ' + rest + ' »' + (sug ? ' — vouliez-vous « ' + sug + ' » ?' : '') +
                    ' (possibles : ' + Object.keys(TRANSITIONS).join(', ') + ')');
                continue;
            }
            if (dur != null && !(dur >= 0.1 && dur <= 3)) { report('error', 'Durée de transition entre 0,1 et 3 s'); continue; }
            cam.transition = { type: t.key, duration: t.key === 'coupe' ? 0 : (dur != null ? round2(dur) : DEFAULT_TRANSITION_SECONDS) };
        } else if ((m = /^dur(?:ee|ation)\s*:?\s*([\d.,]+)\s*s?$/.exec(w))) {
            const d = num(m[1]);
            if (!(d >= 0.5 && d <= 60)) report('error', 'Durée du plan entre 0,5 et 60 s');
            else cam.fixedDuration = round2(d);
        } else if (/^dur(?:ee|ation)\b/.test(w)) {
            report('error', 'Durée illisible « ' + seg + ' » (exemple : duree: 4s)');
        } else {
            for (const part of seg.split(/\s*[+,]\s*|\s+puis\s+|\s+et\s+/i).map(s => s.trim()).filter(Boolean)) {
                const mv = matchSynonym(CAMERA_MOVES, words(part));
                if (!mv) {
                    const first = words(part).split(' ').slice(0, 2).join(' ');
                    const sug = closest(first, Object.keys(CAMERA_MOVES));
                    report('error', 'Mouvement de caméra inconnu « ' + part + ' »' + (sug ? ' — vouliez-vous « ' + sug + ' » ?' : '') +
                        ' (possibles : ' + Object.keys(CAMERA_MOVES).join(', ') + ')');
                    continue;
                }
                const move = { type: mv.key, speed: 'normal', intensity: 'normal' };
                const unknown = [];
                for (const tok of mv.rest.split(' ').filter(Boolean)) {
                    if (SPEEDS[tok]) move.speed = SPEEDS[tok];
                    else if (INTENSITIES[tok]) move.intensity = INTENSITIES[tok];
                    else unknown.push(tok);
                }
                if (unknown.length) {
                    // « zoom-inn » : faute de frappe sur le mouvement (seul « zoom » a été reconnu)
                    // plutôt qu'une précision inconnue comme dans « zoom-in lentement »
                    const head = words(part).split(' ').slice(0, 2).join(' ');
                    const exact = Object.entries(CAMERA_MOVES).some(([k, syns]) =>
                        [k.replace(/-/g, ' '), ...syns].some(syn => head === syn || head.startsWith(syn + ' ') && syn.includes(' ')));
                    const sug = closest(head, Object.keys(CAMERA_MOVES));
                    report('error', !exact && sug
                        ? 'Mouvement de caméra inconnu « ' + part + ' » — vouliez-vous « ' + sug + ' » ?'
                        : 'Précision inconnue « ' + unknown.join(' ') + ' » pour ' + mv.key + ' (lent, rapide, léger, fort)');
                    continue;
                }
                if (cam.moves.some(x => x.type === move.type)) report('warning', 'Mouvement « ' + move.type + ' » répété dans le même plan');
                else cam.moves.push(move);
            }
        }
    }
    const types = cam.moves.map(m => m.type);
    if (types.includes('zoom-in') && types.includes('zoom-out')) report('error', 'zoom-in et zoom-out en même temps');
    if (types.includes('fixe') && types.length > 1) report('error', '« fixe » ne se combine pas avec un autre mouvement');
    return cam;
}

function parseSfx(value, report) {
    let rest = value.trim();
    let at = 0, volume = 1, m;
    if ((m = /\s*vol(?:ume)?\s*:?\s*([\d.,]+)\s*$/i.exec(rest))) {
        volume = num(m[1]); rest = rest.slice(0, m.index);
        if (!(volume >= 0 && volume <= 2)) { report('error', 'Volume du son entre 0 et 2'); volume = 1; }
    }
    if ((m = /\s*@\s*([\d.,]+)\s*s?\s*$/.exec(rest))) {
        at = num(m[1]); rest = rest.slice(0, m.index);
        if (!(at >= 0 && at <= 60)) { report('error', 'Moment du son entre 0 et 60 s'); at = 0; }
    } else if (/@/.test(rest)) {
        report('error', 'Moment du son illisible (exemple : porte-claque @1.2s)');
        rest = rest.replace(/@.*$/, '');
    }
    const name = slug(rest);
    if (!name) { report('error', 'Nom du son manquant'); return null; }
    return { name, label: rest.trim(), at: round2(at), volume: round2(volume) };
}

function parseMusic(value, report, current) {
    let rest = value.trim(), volume = null, m;
    if ((m = /\s*vol(?:ume)?\s*:?\s*([\d.,]+)\s*$/i.exec(rest))) {
        volume = num(m[1]); rest = rest.slice(0, m.index);
        if (!(volume >= 0 && volume <= 1)) { report('error', 'Volume de musique entre 0 et 1'); volume = null; }
    }
    const w = words(rest);
    if (/^(stop|arret|silence|coupe|fin)$/.test(w)) return { action: 'stop', track: null, volume: null };
    if (/^(continue|suite|idem|meme)$/.test(w) || !w) {
        if (!w) report('error', 'MUSIQUE vide (nom de piste, stop ou continue)');
        return { action: 'continue', track: current.track, volume: volume ?? current.volume };
    }
    const track = slug(rest);
    if (current.track === track) return { action: 'continue', track, volume: volume ?? current.volume };
    return { action: 'start', track, label: rest.trim(), volume: volume ?? 0.6 };
}

// ─── Analyse du script ────────────────────────────────────────────
// characters : [{ name, voice: { voiceId, speed } }] — fiches de la série.
export function parseScript(script, characters = []) {
    const errors = [], warnings = [];
    const byName = new Map(characters.map(c => [fold(c.name), c]));
    const plans = [];
    let plan = null, lastTag = null, lastNumber = 0;
    let music = { track: null, volume: null };
    const lines = String(script || '').replace(/\r\n?/g, '\n').split('\n');

    const reportAt = (lineNo, planNo) => (severity, message) =>
        (severity === 'error' ? errors : warnings).push({ line: lineNo, plan: planNo, severity, message });

    const resolveChar = (rawName, report) => {
        const c = byName.get(fold(rawName));
        if (!c) {
            const sug = closest(rawName, characters.map(x => x.name));
            report('error', 'Personnage @' + rawName + ' inconnu dans cette série' + (sug ? ' — vouliez-vous @' + sug + ' ?' : ''));
            return null;
        }
        return c.name;
    };

    const finishPlan = () => {
        if (!plan) return;
        const report = reportAt(plan.line, plan.number);
        if (!plan.image) report('error', 'Plan ' + plan.number + ' sans [IMAGE]');
        // @Nom cités dans l'image ou les répliques : ajoutés aux PERSOS
        const cited = [];
        (plan.image.match(/@([A-Za-zÀ-ÖØ-öø-ÿ0-9_-]+)/g) || []).forEach(t => cited.push(t.slice(1)));
        for (const raw of cited) {
            const name = resolveChar(raw, reportAt(plan.imageLine, plan.number));
            if (name && !plan.persos.includes(name)) {
                plan.persos.push(name);
                reportAt(plan.imageLine, plan.number)('warning', '@' + name + ' cité dans [IMAGE] mais absent de [PERSOS] : ajouté');
            }
        }
        for (const v of plan.voix) {
            if (!plan.persos.includes(v.perso)) {
                reportAt(v.line, plan.number)('warning', '@' + v.perso + ' parle sans être dans [PERSOS] : voix hors champ');
                v.horsChamp = true;
            }
        }
        // Durée
        const voiceSeconds = plan.voix.reduce((sum, v) => {
            const c = byName.get(fold(v.perso));
            const speed = (c && c.voice && c.voice.speed) || 1;
            return sum + v.texte.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND / speed;
        }, 0);
        const voiced = plan.voix.length > 0;
        const estimate = plan.cam.fixedDuration ?? (voiced
            ? Math.max(MIN_VOICED_PLAN, PLAN_LEAD + voiceSeconds + GAP_BETWEEN_LINES * (plan.voix.length - 1) + PLAN_TAIL)
            : DEFAULT_PLAN_SECONDS);
        plan.duration = plan.cam.fixedDuration != null
            ? { mode: 'fixed', seconds: plan.cam.fixedDuration, estimate: plan.cam.fixedDuration }
            : voiced ? { mode: 'audio', seconds: null, estimate: round2(estimate) }
                     : { mode: 'default', seconds: DEFAULT_PLAN_SECONDS, estimate: DEFAULT_PLAN_SECONDS };
        const sfxTooLate = plan.sfx.filter(s => s.at >= plan.duration.estimate);
        sfxTooLate.forEach(s => reportAt(s.line, plan.number)('warning', 'Son « ' + s.name + ' » à ' + s.at + ' s : peut tomber après la fin du plan (~' + plan.duration.estimate + ' s)'));
        if (!plan.cam.moves.length) plan.cam.moves.push({ type: 'fixe', speed: 'normal', intensity: 'normal', implicit: true });
        delete plan.imageLine;
        delete plan._seen;
        plans.push(plan);
    };

    lines.forEach((raw, i) => {
        const lineNo = i + 1;
        const trimmed = raw.trim();
        if (!trimmed) { lastTag = null; return; }          // une ligne vide termine la balise en cours
        if (/^(#|\/\/)/.test(trimmed)) return;
        const m = /^\[\s*([^\]]*?)\s*\]\s*(.*)$/.exec(trimmed);
        const planNo = plan ? plan.number : null;
        if (!m) {
            // ligne sans balise : prolonge la balise précédente
            if (!plan) { reportAt(lineNo, null)('error', 'Texte avant le premier [PLAN]'); return; }
            if (!lastTag || lastTag === 'PLAN') { reportAt(lineNo, planNo)('error', 'Ligne sans balise (commencez par [DECOR], [IMAGE], [VOIX]…)'); return; }
            if (lastTag === 'VOIX' && plan.voix.length) {
                const v = plan.voix[plan.voix.length - 1];
                v.texte = stripQuotes(v.raw + ' ' + trimmed); v.raw += ' ' + trimmed;
            } else if (lastTag === 'IMAGE') plan.image = (plan.image + ' ' + trimmed).trim();
            else if (lastTag === 'DECOR') plan.decor = (plan.decor + ' ' + trimmed).trim();
            else reportAt(lineNo, planNo)('error', 'Une ligne sans balise ne peut prolonger que [IMAGE], [DECOR] ou [VOIX]');
            return;
        }
        const tagRaw = m[1];
        const tag = TAG_ALIASES[fold(tagRaw).toUpperCase().replace(/\s+/g, '')];
        const value = m[2].trim();
        if (!tag) {
            const sug = closest(tagRaw, TAGS.map(t => t.toLowerCase()));
            reportAt(lineNo, planNo)('error', 'Balise inconnue [' + tagRaw + ']' + (sug ? ' — vouliez-vous [' + sug.toUpperCase() + '] ?' : ''));
            lastTag = null;
            return;
        }
        if (/\[\s*(PLAN|DECOR|PERSOS|IMAGE|CAM|VOIX|SFX|MUSIQUE)\s*\]/i.test(value)) {
            reportAt(lineNo, planNo)('error', 'Une seule balise par ligne');
        }
        if (tag !== 'PLAN' && !plan) { reportAt(lineNo, null)('error', '[' + tag + '] avant le premier [PLAN]'); return; }
        lastTag = tag;

        if (tag === 'PLAN') {
            finishPlan();
            const pm = /^(\d+)?\s*[-—–:.]?\s*(.*)$/.exec(value);
            let number = pm[1] ? parseInt(pm[1], 10) : lastNumber + 1;
            if (plans.some(p => p.number === number)) {
                reportAt(lineNo, number)('error', 'Numéro de plan ' + number + ' déjà utilisé');
            } else if (pm[1] && number !== lastNumber + 1 && plans.length) {
                reportAt(lineNo, number)('warning', 'Plan ' + number + ' après le plan ' + lastNumber + ' : numérotation non continue');
            }
            lastNumber = number;
            const prev = plans[plans.length - 1];
            plan = {
                index: plans.length, number, id: 'P' + number, title: pm[2] || '', line: lineNo,
                decor: prev ? prev.decor : '', decorInherited: !!prev, persos: [], image: '', imageLine: lineNo,
                cam: { moves: [], transition: { type: 'coupe', duration: 0 }, fixedDuration: null },
                voix: [], sfx: [], musique: { action: 'continue', track: music.track, volume: music.volume },
                _seen: {}
            };
            return;
        }

        const report = reportAt(lineNo, plan.number);
        if (SINGLE_TAGS.includes(tag)) {
            if (plan._seen[tag]) { report('error', '[' + tag + '] déjà présent dans le plan ' + plan.number); return; }
            plan._seen[tag] = true;
        }
        if (!value && tag !== 'PERSOS' && tag !== 'IMAGE' && tag !== 'DECOR') { report('error', '[' + tag + '] vide'); return; }

        switch (tag) {
            case 'DECOR':
                plan.decor = value; plan.decorInherited = false;
                break;
            case 'PERSOS': {
                const toks = value.split(/[\s,;]+|\bet\b/).map(t => t.trim()).filter(Boolean);
                for (const t of toks) {
                    if (!t.startsWith('@')) { report('error', '« ' + t + ' » : écrivez @' + t.replace(/^@/, '')); continue; }
                    const name = resolveChar(t.slice(1), report);
                    if (name && !plan.persos.includes(name)) plan.persos.push(name);
                }
                break;
            }
            case 'IMAGE':
                plan.image = value; plan.imageLine = lineNo;
                break;
            case 'CAM':
                plan.cam = parseCam(value, report);
                break;
            case 'VOIX': {
                const vm = /^@([^\s:(]+)\s*(?:\(([^)]*)\))?\s*:\s*([\s\S]*)$/.exec(value);
                if (!vm) { report('error', 'Réplique illisible : écrivez @Nom: « texte » ou @Nom (ton): « texte »'); break; }
                const name = resolveChar(vm[1], report);
                const texte = stripQuotes(vm[3]);
                if (!texte) { report('error', 'Réplique vide pour @' + vm[1]); break; }
                if (name) plan.voix.push({ perso: name, ton: vm[2] ? vm[2].trim() : null, texte, raw: vm[3], line: lineNo });
                break;
            }
            case 'SFX': {
                const s = parseSfx(value, report);
                if (s) plan.sfx.push({ ...s, line: lineNo });
                break;
            }
            case 'MUSIQUE':
                plan.musique = parseMusic(value, report, music);
                music = plan.musique.action === 'stop' ? { track: null, volume: null } : { track: plan.musique.track, volume: plan.musique.volume };
                break;
        }
    });
    finishPlan();

    // script vide : pas une erreur (épisode en brouillon) ; script sans [PLAN] : erreur
    if (!plans.length && !errors.length && String(script || '').trim()) errors.push({ line: 1, plan: null, severity: 'error', message: 'Aucun [PLAN] dans le script' });
    if (plans.length && !plans[0].decor) warnings.push({ line: plans[0].line, plan: plans[0].number, severity: 'warning', message: 'Premier plan sans [DECOR]' });
    plans.forEach(p => p.voix.forEach(v => delete v.raw));

    const estimatedSeconds = round2(plans.reduce((s, p) => s + p.duration.estimate, 0));
    const used = [...new Set(plans.flatMap(p => [...p.persos, ...p.voix.map(v => v.perso)]))];
    errors.sort((a, b) => a.line - b.line);
    warnings.sort((a, b) => a.line - b.line);
    return {
        version: PARSER_VERSION,
        hash: hashString(String(script || '') + '|' + characters.map(c => c.name + ':' + ((c.voice && c.voice.speed) || 1)).join(',')),
        ok: errors.length === 0 && plans.length > 0,
        plans, errors, warnings,
        stats: {
            plans: plans.length,
            voix: plans.reduce((s, p) => s + p.voix.length, 0),
            sfx: plans.reduce((s, p) => s + p.sfx.length, 0),
            characters: used,
            tracks: [...new Set(plans.filter(p => p.musique.action === 'start').map(p => p.musique.track))],
            estimatedSeconds,
            target: EPISODE_TARGET
        }
    };
}
