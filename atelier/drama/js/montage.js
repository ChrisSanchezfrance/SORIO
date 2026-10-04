// Drama — étape 5 : montage (partie pure, testable avec Node).
// Construit la « timeline » d'un épisode à partir des plans analysés, du minutage des voix
// (étape 4), des images retenues (étape 3) et de la bibliothèque de musiques / bruitages :
//   plans (image, mouvement de caméra, transition d'entrée), voix, bruitages, musiques,
//   sous-titres et zones où la musique baisse sous les voix.
// Le dessin (render.js), le mixage (mix.js) et l'export (étape 6) lisent cette timeline.

import { hashString } from './parser.js';

export const W = 1080, H = 1920, FPS = 30;
export const DEFAULT_MONTAGE = Object.freeze({ subtitles: true, subSize: 'M', musicVolume: 0.8, duck: 0.25 });
export const SUB_SIZES = { S: 54, M: 64, L: 78 };

const ZOOM_AMOUNT = { lent: 0.07, normal: 0.12, rapide: 0.2 };
const PAN_ZOOM = 1.12;                                   // marge nécessaire pour un panoramique
const PAN_SPAN = { lent: 0.55, normal: 0.8, rapide: 1 };  // part de la marge parcourue
const SHAKE_AMP = { leger: 5, normal: 11, fort: 22 };     // pixels (image de 1080 de large)
const SHAKE_ZOOM = 1.04;
const MUSIC_FADE = 0.8;                                    // fondu d'entrée / sortie de la musique (s)
const DUCK_ATTACK = 0.12, DUCK_RELEASE = 0.35;
const r3 = n => Math.round(n * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const ease = p => 0.5 - Math.cos(Math.PI * clamp(p, 0, 1)) / 2;

// Bruit doux et déterministe dans [-1, 1] (tremblement reproductible à l'export).
const noise = (t, seed) => 0.6 * Math.sin(2.1 * t + seed * 1.7) + 0.4 * Math.sin(3.7 * t + seed * 0.9 + 1.3);

// ─── Caméra ───────────────────────────────────────────────────────
// p : avancement du plan (0 → 1), t : secondes depuis le début du plan.
// Retourne z (1 = image plein cadre, sans marge) et le décalage x, y en pixels (image 1080×1920).
export function cameraAt(moves, p, t = 0, seed = 0) {
    const e = ease(p);
    let z = 1, x = 0, y = 0;
    const has = type => moves.some(m => m.type === type);
    for (const m of moves) {
        const a = ZOOM_AMOUNT[m.speed] || ZOOM_AMOUNT.normal;
        if (m.type === 'zoom-in') z *= 1 + a * e;
        if (m.type === 'zoom-out') z *= 1 + a * (1 - e);
    }
    if (moves.some(m => m.type.startsWith('pan-'))) z *= PAN_ZOOM;
    if (has('tremblement')) z *= SHAKE_ZOOM;
    z = r3(z);    // la marge est calculée sur le zoom réellement appliqué
    const roomX = (z - 1) * W / 2, roomY = (z - 1) * H / 2;
    for (const m of moves) {
        const k = PAN_SPAN[m.speed] || PAN_SPAN.normal;
        const d = (2 * e - 1) * k;     // -k → +k
        // « pan gauche » : la caméra va vers la gauche, l'image glisse vers la droite
        if (m.type === 'pan-gauche') x += roomX * d;
        if (m.type === 'pan-droite') x -= roomX * d;
        if (m.type === 'pan-haut') y += roomY * d;
        if (m.type === 'pan-bas') y -= roomY * d;
        if (m.type === 'tremblement') {
            const amp = SHAKE_AMP[m.intensity] || SHAKE_AMP.normal;
            const f = m.speed === 'rapide' ? 12 : m.speed === 'lent' ? 4 : 8;
            x += amp * noise(t * f, seed);
            y += amp * noise(t * f, seed + 100);
        }
    }
    const cut = v => Math.trunc(v * 1000) / 1000;   // arrondi vers zéro : jamais au-delà de la marge
    return { z, x: cut(clamp(x, -roomX, roomX)), y: cut(clamp(y, -roomY, roomY)) };
}

// ─── Sous-titres ──────────────────────────────────────────────────
// voices : [{ start, duration, text, words: [{ w, s, e }] (relatifs à la réplique) }]
const MAX_CHARS = 42, MAX_WORDS = 8, MIN_CUE = 0.8, HOLD = 0.2;
const cleanWord = w => w.replace(/[«»“”"]/g, '').trim();

export function buildCues(voices) {
    const cues = [];
    for (const v of voices) {
        let words = (v.words && v.words.length ? v.words : null);
        if (!words) {   // sans horodatage : mots répartis sur la durée de la réplique
            const list = String(v.text || '').split(/\s+/).filter(Boolean);
            const step = v.duration / Math.max(1, list.length);
            words = list.map((w, i) => ({ w, s: i * step, e: (i + 1) * step }));
        }
        words = words.map(x => ({ w: cleanWord(x.w), s: v.start + x.s, e: v.start + x.e })).filter(x => x.w);
        const chunks = [];
        let cur = [];
        const len = list => list.reduce((n, x) => n + x.w.length + 1, -1);
        for (const wd of words) {
            if (cur.length && (len(cur.concat(wd)) > MAX_CHARS || cur.length >= MAX_WORDS)) { chunks.push(cur); cur = []; }
            cur.push(wd);
            if (/[.!?…]$/.test(wd.w) || (/[,;:]$/.test(wd.w) && len(cur) > 20)) { chunks.push(cur); cur = []; }
        }
        if (cur.length) chunks.push(cur);
        const end = v.start + v.duration;
        chunks.forEach((c, i) => {
            const next = chunks[i + 1];
            const start = c[0].s;
            let stop = Math.max(c[c.length - 1].e + HOLD, start + MIN_CUE);
            if (next) stop = Math.min(stop, next[0].s);
            stop = Math.min(stop, end + 0.3);
            cues.push({ start: r3(start), end: r3(Math.max(stop, start + 0.1)), text: c.map(x => x.w).join(' '), perso: v.perso });
        });
    }
    return cues.sort((a, b) => a.start - b.start);
}

// ─── Musique et baisse sous les voix ──────────────────────────────
export function musicSegments(plans, duration) {
    const segs = [];
    let cur = null;
    for (const p of plans) {
        const m = p.musique || { action: 'continue' };
        if (m.action === 'start') {
            if (cur) { cur.end = p.start; segs.push(cur); }
            cur = { track: m.track, label: m.label || m.track, start: p.start, volume: m.volume ?? 0.6 };
        } else if (m.action === 'stop') {
            if (cur) { cur.end = p.start; segs.push(cur); cur = null; }
        }
    }
    if (cur) { cur.end = duration; segs.push(cur); }
    return segs.filter(s => s.end > s.start).map(s => ({ ...s, start: r3(s.start), end: r3(s.end) }));
}

// Intervalles où une voix parle (fusionnés si proches).
export function duckIntervals(voices) {
    const iv = voices.map(v => [v.start - DUCK_ATTACK, v.start + v.duration + DUCK_RELEASE]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [s, e] of iv) {
        const last = out[out.length - 1];
        if (last && s <= last.end) last.end = Math.max(last.end, e);
        else out.push({ start: s, end: e });
    }
    return out.map(d => ({ start: r3(Math.max(0, d.start)), end: r3(d.end) }));
}

// Points de l'enveloppe de volume d'un segment de musique : [{ t, v }] (temps absolus).
// Volume = volume du segment × réglage musique × fondu d'entrée/sortie × baisse sous les voix.
export function musicEnvelope(seg, ducks, settings = {}) {
    const s = { ...DEFAULT_MONTAGE, ...settings };
    const base = seg.volume * s.musicVolume;
    const fade = Math.min(MUSIC_FADE, (seg.end - seg.start) / 2);
    const fadeAt = t => t <= seg.start ? 0 : t >= seg.end ? 0
        : Math.min(1, (t - seg.start) / fade, (seg.end - t) / fade);
    const inside = ducks.filter(d => d.end > seg.start && d.start < seg.end);
    const duckAt = t => {
        let f = 1;
        for (const d of inside) {
            if (t <= d.start || t >= d.end) continue;
            const down = Math.min(1, (t - d.start) / DUCK_ATTACK), up = Math.min(1, (d.end - t) / DUCK_RELEASE);
            f = Math.min(f, 1 - (1 - s.duck) * Math.min(down, up));
        }
        return f;
    };
    const times = new Set([seg.start, seg.start + fade, seg.end - fade, seg.end]);
    for (const d of inside) [d.start, d.start + DUCK_ATTACK, d.end - DUCK_RELEASE, d.end].forEach(t => times.add(t));
    return [...times].filter(t => t >= seg.start && t <= seg.end).sort((a, b) => a - b)
        .map(t => ({ t: r3(t), v: r3(base * fadeAt(t) * duckAt(t)) }))
        .filter((p, i, a) => !i || p.t !== a[i - 1].t);
}

export function envelopeAt(pts, t) {
    if (!pts.length || t <= pts[0].t) return pts.length ? pts[0].v : 0;
    for (let i = 1; i < pts.length; i++) {
        if (t <= pts[i].t) {
            const a = pts[i - 1], b = pts[i];
            return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
        }
    }
    return pts[pts.length - 1].v;
}

// ─── Timeline ─────────────────────────────────────────────────────
// timing : computeTiming() de l'étape 4 ; shots : { planId: assetId } ; takes : { lineId: { assetId, words } } ;
// library : { music: { nom: { assetId, duration } }, sfx: { nom: { assetId, duration } } } ;
// clips (étape 8) : { planId: { assetId, duration, audio } } plans animés par Agnes (audio : son du clip utilisé).
export function buildTimeline({ analysis, timing, shots = {}, takes = {}, library = { music: {}, sfx: {} }, settings = {}, clips = {} }) {
    const s = { ...DEFAULT_MONTAGE, ...settings };
    const plans = analysis.plans.map((p, i) => {
        const tp = timing.plans[i];
        const tr = { ...p.cam.transition };
        tr.duration = r3(Math.min(tr.duration, tp.duration / 2));
        const plan = {
            id: p.id, index: i, start: tp.start, duration: tp.duration, end: r3(tp.start + tp.duration),
            imageAssetId: shots[p.id] || null, moves: p.cam.moves, transition: tr, seed: i * 7.3 + 1,
            musique: p.musique, sfx: p.sfx, decor: p.decor
        };
        // plan animé : le clip remplace l'image (sans zoom ni panoramique)
        if (clips[p.id]) plan.clip = { assetId: clips[p.id].assetId, duration: clips[p.id].duration };
        return plan;
    });
    // son des clips dont la voix est celle d'Agnes (coupé à la fin du plan)
    const clipAudio = plans.filter(p => p.clip && clips[p.id].audio)
        .map(p => ({ planId: p.id, assetId: p.clip.assetId, start: p.start, duration: p.duration }));
    const voices = [];
    timing.plans.forEach((tp, i) => tp.lines.forEach((l, j) => {
        const take = takes[l.id];
        const v = analysis.plans[i].voix[j];
        const agnes = !!(l.agnes && clips[tp.id] && clips[tp.id].audio);     // dite par Agnes dans le clip
        voices.push({
            lineId: l.id, perso: v.perso, text: v.texte, assetId: take && !agnes ? take.assetId : null, agnes,
            start: r3(tp.start + l.start), duration: l.duration ?? l.estimate, words: take && !agnes ? take.words : null
        });
    }));
    const sfx = plans.flatMap(p => p.sfx.map(x => ({
        name: x.name, label: x.label || x.name, start: r3(p.start + x.at), volume: x.volume,
        assetId: (library.sfx[x.name] && library.sfx[x.name].assetId) || null
    })));
    const music = musicSegments(plans, timing.total).map(m => ({
        ...m, assetId: (library.music[m.track] && library.music[m.track].assetId) || null
    }));
    const ducks = duckIntervals(voices.filter(v => v.assetId || v.agnes));
    return {
        width: W, height: H, fps: FPS, duration: timing.total, settings: s,
        plans, voices, sfx, music, ducks, clipAudio,
        cues: s.subtitles ? buildCues(voices) : [],
        missing: {
            images: plans.filter(p => !p.imageAssetId).map(p => p.id),
            voices: voices.filter(v => !v.assetId && !v.agnes).map(v => v.lineId),
            music: [...new Set(music.filter(m => !m.assetId).map(m => m.track))],
            sfx: [...new Set(sfx.filter(x => !x.assetId).map(x => x.name))]
        }
    };
}

// Plan affiché au temps t (le dernier plan reste affiché jusqu'à la fin).
export function planIndexAt(tl, t) {
    const ps = tl.plans;
    let lo = 0, hi = ps.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ps[mid].start <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
}

export function cueAt(tl, t) {
    return tl.cues.find(c => t >= c.start && t < c.end) || null;
}

// Noms des musiques et bruitages appelés par le script (bibliothèque à importer).
export function requiredSounds(analysis) {
    const music = new Map(), sfx = new Map();
    for (const p of (analysis && analysis.plans) || []) {
        if (p.musique.action === 'start') music.set(p.musique.track, p.musique.label || p.musique.track);
        for (const x of p.sfx) sfx.set(x.name, x.label || x.name);
    }
    return { music: [...music].map(([name, label]) => ({ name, label })), sfx: [...sfx].map(([name, label]) => ({ name, label })) };
}

// ─── Morceaux vidéo (étape 7) ─────────────────────────────────────
// Un morceau par plan : images [i0, i1) à 30 i/s. Son empreinte ne dépend que de ce qui est
// dessiné dans ces images (plan, plan précédent pendant la transition, sous-titres affichés,
// réglages, encodeur) : après une modification, seuls les morceaux touchés sont réencodés.
export function videoSegments(tl, codecKey = '') {
    const total = Math.max(1, Math.round(tl.duration * FPS));
    const last = tl.plans.length - 1;
    return tl.plans.map((p, k) => {
        const i0 = Math.round(p.start * FPS);
        const i1 = k === last ? total : Math.round(p.end * FPS);
        const prev = k > 0 ? tl.plans[k - 1] : null;
        const t0 = i0 / FPS, t1 = i1 / FPS;
        const sig = {
            codecKey, i0, i1,
            plan: { img: p.imageAssetId, moves: p.moves, tr: p.transition, seed: p.seed, start: p.start, duration: p.duration, ...(p.clip ? { clip: p.clip } : {}) },
            prev: prev && p.transition.type !== 'coupe' ? { img: prev.imageAssetId, moves: prev.moves, seed: prev.seed, duration: prev.duration, ...(prev.clip ? { clip: prev.clip } : {}) } : null,
            cues: tl.settings.subtitles ? tl.cues.filter(c => c.end > t0 && c.start < t1) : []
        };
        // la taille des sous-titres ne compte que pour les plans qui en affichent
        sig.sub = sig.cues.length ? tl.settings.subSize : null;
        return { planId: p.id, i0, i1, frames: i1 - i0, hash: hashString(JSON.stringify(sig)) };
    }).filter(s => s.frames > 0);
}
