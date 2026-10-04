// Drama — étape 8 : plans animés par Agnes (vidéo).
//
// L'image du plan est envoyée au modèle vidéo d'Agnes (le même que l'onglet Vidéos) avec la scène,
// le mouvement de caméra et la réplique : le personnage bouge et parle (lèvres sur le texte).
// Le montage utilise ensuite le clip à la place de l'image fixe.
// Voix d'un plan animé :
//   'own'   (par défaut) : votre voix (micro ou ElevenLabs), le clip est muet dans le montage ;
//   'agnes' : la voix du clip, synchronisée avec les lèvres ; la durée du plan devient celle du clip.
// Empreinte d'un clip = modèle + prompt + image du plan : le clip n'est refait que si l'un d'eux change.
// Une création lancée est mémorisée : si l'appli est fermée, elle est reprise sans être relancée.
//
// La partie « prompt + longueur » est pure (testable avec Node).

import { hashString, fold } from './parser.js';
import { get, tx, getByIndex, newId } from './db.js';
import { linkMedia, getAsset } from './model.js';
import { createVideo, videoStatus, fetchVideoContent, AgnesError, VIDEO_MODEL, VIDEO_FPS } from './agnes.js';
import { RETRY_WAITS, waitVisible, pausableWait, blobToDataUri } from './jobs.js';
import { getShots, findCachedAsset } from './images.js';
import { voiceStates } from './voices.js';

export const CLIP_LENGTHS = [121, 153, 241];                  // images à 24 i/s : 5 s, 6,4 s, 10 s
export const MAX_CLIP_SECONDS = CLIP_LENGTHS[CLIP_LENGTHS.length - 1] / VIDEO_FPS;
export const MAX_CLIPS = 4;                                    // versions gardées par plan
// Rythme des demandes (comme l'onglet Vidéos) ; modifiable pour les tests.
export const CLIP_TIMING = {
    createEvery: 62,       // secondes entre deux créations
    pollEvery: 8,          // secondes entre deux consultations
    maxPolls: 100,
    estimate: 165,         // durée de création estimée (s) tant qu'aucune n'a été mesurée
    minFirstWait: 20,      // première consultation au plus tôt après…
    retryScale: 1          // multiplicateur des attentes après 429 / 503
};
const WAITS_429 = [15, 30, 45, 60, 90, 120, 180];
const WAITS_503 = [5, 10, 15, 20, 30, 45];
const LAST_CREATE = 'drama_clip_last_create';
const TIMES = 'drama_clip_times';
const r3 = n => Math.round(n * 1000) / 1000;
const sentence = s => { const t = String(s || '').trim(); return /[.!?…»"]$/.test(t) ? t : t + '.'; };
const NAME_TAG = /@([A-Za-zÀ-ÖØ-öø-ÿ0-9_-]+)/g;

// ─── Prompt + longueur (pur) ──────────────────────────────────────
// Plus court clip qui couvre la durée du plan (10 s au plus).
export function pickFrames(seconds) {
    return CLIP_LENGTHS.find(f => f / VIDEO_FPS >= seconds - 1e-6) || CLIP_LENGTHS[CLIP_LENGTHS.length - 1];
}
export const clipSeconds = frames => r3(frames / VIDEO_FPS);

// Animé par défaut : les plans où quelqu'un parle.
export const defaultAnimate = plan => plan.voix.length > 0;

const CAMERA = {
    'fixe': 'static camera, no camera movement',
    'zoom-in': 'slow camera push-in toward the subject',
    'zoom-out': 'slow camera pull-back revealing the scene',
    'pan-gauche': 'camera pans slowly to the left',
    'pan-droite': 'camera pans slowly to the right',
    'pan-haut': 'camera tilts slowly upward',
    'pan-bas': 'camera tilts slowly downward',
    'tremblement': 'subtle handheld camera shake'
};

// imageHash : empreinte de l'image retenue pour le plan (étape 3) ; null si pas encore d'image.
export function buildClipRequest(project, characters, plan, imageHash) {
    if (!imageHash) return { planId: plan.id, error: 'Générez d\'abord l\'image du plan' };
    const byName = new Map(characters.map(c => [fold(c.name), c]));
    const style = project.style || {};
    const lines = [
        'Animate this exact image as the starting frame of a vertical 9:16 cinematic drama scene. ' +
        'The characters must remain IDENTICAL to the input image: same face, same hair, same outfit, same identity. ' +
        'This is a CONTINUATION of the source image, not a re-imagination: keep the setting, framing and art style.'
    ];
    if (style.text) lines.push('Art style: ' + sentence(style.text));
    if (plan.decor) lines.push('Setting: ' + sentence(plan.decor));
    lines.push('Action: ' + sentence(String(plan.image || '').replace(NAME_TAG, '$1')));
    for (const n of plan.persos) {
        const c = byName.get(fold(n));
        if (c) lines.push('Recurring character ' + c.name + (c.desc ? ': ' + c.desc.replace(/[.\s]+$/, '') : '') +
            '. Keep ' + c.name + '\'s face, hairstyle, body shape and outfit exactly the same in every frame.');
    }
    const onScreen = plan.voix.filter(v => !v.horsChamp);
    if (plan.voix.length) {
        const said = plan.voix.map((v, i) => {
            const who = v.horsChamp ? 'an off-screen voice (nobody on screen moves their lips)' : v.perso;
            return (i ? 'then ' : '') + who + (v.ton ? ' (' + v.ton + ')' : '') + ': "' + v.texte + '"';
        });
        lines.push('Spoken dialogue: ' + (onScreen.length
            ? 'the character says the following words aloud, with clearly visible lip movements matching each syllable and natural facial expressions, in the language they are written in — '
            : 'the following words are heard, in the language they are written in — ') + said.join(', ') + '.');
        if (plan.persos.length > 1 && onScreen.length) lines.push('Only the character who is speaking moves their lips; the others listen with their mouths closed.');
    } else {
        lines.push('Nobody speaks: mouths stay closed. Only natural motion, breathing, light and atmosphere are animated.');
    }
    lines.push('Camera: ' + plan.cam.moves.map(m => CAMERA[m.type] || CAMERA.fixe).join(', ') + '.');
    lines.push(plan.voix.length ? 'Sound design: natural voice with realistic lip sync, soft room tone, no music.'
        : 'Sound design: minimal foley, soft ambient textures, no music, no dialogue.');
    lines.push('Vertical 9:16, 24fps, no text, no subtitles, no watermarks, consistent character design with the source image.');
    const prompt = lines.join('\n');
    const negative = ['text, subtitles, watermark, logo, deformed face, extra fingers, identity change', style.negative]
        .filter(Boolean).map(x => String(x).replace(/[.\s]+$/, '')).join(', ');
    const hash = hashString(JSON.stringify(['clip', VIDEO_MODEL, prompt, negative, imageHash]));
    return { planId: plan.id, prompt, negative, hash, model: VIDEO_MODEL };
}

// ─── Stockage ─────────────────────────────────────────────────────
// Un enregistrement par plan : réglages (animate, audio), clip retenu et versions, création en cours.
export const clipId = (episodeId, planId) => episodeId + ':' + planId;
export const getClip = (episodeId, planId) => get('clips', clipId(episodeId, planId));
export async function getClips(episodeId) {
    const list = await getByIndex('clips', 'episodeId', episodeId);
    return new Map(list.map(c => [c.planId, c]));
}

// Lecture-modification-écriture de l'enregistrement d'un plan, en une transaction.
async function updateClip(projectId, episodeId, planId, fn) {
    const id = clipId(episodeId, planId);
    let saved = null;
    await tx('clips', 'readwrite', s => {
        const req = s.get(id);
        req.onsuccess = () => {
            const c = req.result || { id, projectId, episodeId, planId, versions: [], current: null, hash: null, animate: null, audio: 'own', pending: null };
            fn(c);
            c.updatedAt = Date.now();
            s.put(c);
            saved = c;
        };
    });
    return saved;
}

// prefs : { animate: true | false | null (par défaut), audio: 'own' | 'agnes' }
export function saveClipPrefs(projectId, episodeId, planId, prefs) {
    return updateClip(projectId, episodeId, planId, c => {
        if ('animate' in prefs) c.animate = prefs.animate == null ? null : !!prefs.animate;
        if ('audio' in prefs) c.audio = prefs.audio === 'agnes' ? 'agnes' : 'own';
    });
}
const savePending = (projectId, episodeId, planId, pending) => updateClip(projectId, episodeId, planId, c => { c.pending = pending; });

function setClipAsset(projectId, episodeId, planId, asset, isNew = false) {
    return linkMedia('clips', { id: clipId(episodeId, planId), projectId, episodeId, planId, animate: null, audio: 'own' },
        asset, MAX_CLIPS, { isNew, extra: { pending: null, remote: null } });
}

export async function selectClipVersion(episodeId, planId, assetId) {
    const c = await getClip(episodeId, planId);
    if (!c || !c.versions.includes(assetId)) return null;
    const a = await getAsset(assetId);
    return updateClip(c.projectId, episodeId, planId, x => { x.current = assetId; x.hash = a ? a.hash : x.hash; });
}

// Enregistre le fichier d'un clip comme nouvelle version du plan. info : { hash, frames, prompt, videoId }.
async function saveClipBlob(project, episode, planId, blob, info) {
    const meta = await probeClip(blob, info.frames ? clipSeconds(info.frames) : 0);
    if (!meta.duration) throw new AgnesError('Vidéo illisible sur ce téléphone');
    const asset = {
        id: newId('a'), projectId: project.id, kind: 'clip', episodeId: episode.id, planId,
        hash: info.hash, model: info.videoId ? VIDEO_MODEL : 'import', frames: info.frames || null, prompt: info.prompt || null,
        videoId: info.videoId || null, mime: blob.type || 'video/mp4', ...meta, blob, createdAt: Date.now()
    };
    return setClipAsset(project.id, episode.id, planId, asset, true);
}

// Importe une vidéo du téléphone comme clip du plan (clip d'Agnes téléchargé à la main,
// ou vidéo de l'onglet Vidéos). Elle vaut tant que l'image et le plan ne changent pas.
export async function importClipFile(project, characters, episode, planId, file) {
    if (!file || !/^video\//.test(file.type || '') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name || '')) throw new AgnesError('Choisissez une vidéo');
    const plan = ((episode.analysis && episode.analysis.plans) || []).find(p => p.id === planId);
    if (!plan) throw new AgnesError('Plan introuvable');
    const sh = (await getShots(episode.id)).get(planId);
    const req = buildClipRequest(project, characters, plan, sh && sh.current ? sh.hash : null);
    if (req.error) throw new AgnesError(req.error);
    const c = await getClip(episode.id, planId);
    const info = c && c.remote && c.remote.hash === req.hash ? c.remote : { hash: req.hash, prompt: req.prompt };
    const blob = file.type && /^video\//.test(file.type) ? file : new Blob([file], { type: 'video/mp4' });
    return saveClipBlob(project, episode, planId, blob, info);
}

// ─── États ────────────────────────────────────────────────────────
const clipMeta = a => a ? { id: a.id, duration: a.duration, hasAudio: !!a.hasAudio, width: a.width, height: a.height, frames: a.frames } : null;

// Clips à jour et retenus pour le montage : { planId: { clip, asset, plan } }.
async function validClips(project, characters, episode) {
    const out = {};
    const plans = (episode.analysis && episode.analysis.plans) || [];
    const clips = await getClips(episode.id);
    if (!clips.size) return out;
    const shots = await getShots(episode.id);
    for (const plan of plans) {
        const c = clips.get(plan.id);
        if (!c || !c.current) continue;
        if (!(c.animate != null ? c.animate : defaultAnimate(plan))) continue;
        const sh = shots.get(plan.id);
        const req = buildClipRequest(project, characters, plan, sh && sh.current ? sh.hash : null);
        if (req.error || c.hash !== req.hash) continue;
        const asset = await getAsset(c.current);
        if (asset) out[plan.id] = { clip: c, asset, plan };
    }
    return out;
}

// Plans dont la voix est celle du clip Agnes : { planId: durée du clip }.
export async function agnesVoicePlans(project, characters, episode) {
    const out = {};
    for (const [pid, v] of Object.entries(await validClips(project, characters, episode))) {
        if (v.clip.audio === 'agnes' && v.asset.hasAudio) out[pid] = r3(v.asset.duration);
    }
    return out;
}

// Clips pour le montage : { planId: { assetId, duration, audio } } (audio : le son du clip est utilisé).
export async function timelineClips(project, characters, episode) {
    const out = {};
    for (const [pid, v] of Object.entries(await validClips(project, characters, episode))) {
        out[pid] = { assetId: v.asset.id, duration: r3(v.asset.duration), audio: v.clip.audio === 'agnes' && !!v.asset.hasAudio };
    }
    return out;
}

// État de chaque plan : off (non animé), noimage, ok, pending (création en cours chez Agnes),
// remote (clip prêt chez Agnes, à télécharger puis importer),
// cached, stale (image ou plan modifié depuis), missing.
export async function clipStates(project, characters, episode) {
    const plans = (episode.analysis && episode.analysis.plans) || [];
    const [clips, shots] = await Promise.all([getClips(episode.id), getShots(episode.id)]);
    // durée de chaque plan avec votre voix (prises ou estimation) : longueur de clip à demander
    const { timing } = await voiceStates(project, characters, episode, { agnes: {} });
    const out = [];
    for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const c = clips.get(plan.id) || null;
        const sh = shots.get(plan.id);
        const animate = c && c.animate != null ? c.animate : defaultAnimate(plan);
        const audio = (c && c.audio) || 'own';
        const req = buildClipRequest(project, characters, plan, sh && sh.current ? sh.hash : null);
        const need = timing.plans[i] ? timing.plans[i].duration : 0;
        const asset = c && c.current ? clipMeta(await getAsset(c.current)) : null;
        let state;
        if (!animate) state = 'off';
        else if (req.error) state = 'noimage';
        else if (c && c.remote && c.remote.hash === req.hash) state = 'remote';   // nouveau clip à importer (l'ancien reste au montage)
        else if (c && c.current && c.hash === req.hash) state = 'ok';
        else if (c && c.pending && c.pending.hash === req.hash) state = 'pending';
        else if (await findCachedAsset(project.id, req.hash, 'clip')) state = 'cached';
        else state = c && c.current ? 'stale' : 'missing';
        out.push({
            plan, animate, audio, req, clip: c, asset, state, need: r3(need), frames: pickFrames(need),
            shotAssetId: sh && sh.current ? sh.current : null,
            tooLong: need > MAX_CLIP_SECONDS + 0.01,
            short: state === 'ok' && audio === 'own' && !!asset && asset.duration + 0.05 < need
        });
    }
    return out;
}

// ─── Création ─────────────────────────────────────────────────────
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

// Durée de création estimée (moyenne des dernières mesurées pour cette longueur).
export function estimateSeconds(frames) {
    let t = {};
    try { t = JSON.parse(lsGet(TIMES) || '{}'); } catch (e) {}
    const list = t[frames] || Object.values(t).flat();
    return list && list.length ? list.reduce((a, b) => a + b, 0) / list.length : CLIP_TIMING.estimate;
}
function recordTime(frames, seconds) {
    let t = {};
    try { t = JSON.parse(lsGet(TIMES) || '{}'); } catch (e) {}
    t[frames] = (t[frames] || []).concat(Math.round(seconds)).slice(-6);
    lsSet(TIMES, JSON.stringify(t));
}

let spacing = null;      // écart entre deux créations (s), augmenté après un 429
const createEvery = () => spacing == null ? CLIP_TIMING.createEvery : spacing;

// Attend l'écart minimal depuis la dernière création (même après une fermeture de l'appli).
async function waitSpacing(signal, onTick) {
    const last = parseInt(lsGet(LAST_CREATE) || '0', 10) || 0;
    const left = (last + createEvery() * 1000 - Date.now()) / 1000;
    if (left > 0 && left <= createEvery()) await pausableWait(left, signal, onTick);
}

// Appel avec reprises : 429 et 503 comme l'onglet Vidéos, autres erreurs temporaires comme les images.
async function retrying(fn, signal, onWait) {
    for (let attempt = 0; ; attempt++) {
        await waitVisible(signal);
        try { return await fn(); }
        catch (e) {
            if (e.name === 'AbortError' || !e.retryable) throw e;
            const list = e.status === 429 ? WAITS_429 : e.status === 503 ? WAITS_503 : RETRY_WAITS;
            if (attempt >= list.length) throw e;
            if (e.status === 429) spacing = Math.min(90, createEvery() + 8);
            const wait = Math.max(e.retryAfter || 0, list[attempt]) * CLIP_TIMING.retryScale;
            await pausableWait(wait, signal, left => onWait && onWait(left, e.message));
        }
    }
}

class BlockedDownload extends Error {}

async function getVideo(url, signal) {
    let res;
    try { res = await fetch(url, { signal, credentials: 'omit' }); }
    catch (e) {
        if (signal && signal.aborted) throw new DOMException('Arrêt demandé', 'AbortError');
        throw new BlockedDownload(e.message);       // le plus souvent : hébergeur sans autorisation CORS
    }
    if (!res.ok) throw new AgnesError('Clip créé mais impossible à télécharger (HTTP ' + res.status + ')', { retryable: res.status >= 500 });
    const blob = await res.blob();
    if (!blob.size) throw new AgnesError('Clip vide', { retryable: true });
    return blob;
}
const asVideo = blob => blob.type && /^video\//.test(blob.type) ? blob : new Blob([blob], { type: 'video/mp4' });

// Récupère le fichier du clip : adresse renvoyée (en https), puis téléchargement par l'API.
// Si le téléphone n'a le droit de lire ni l'un ni l'autre : BlockedDownload (import manuel).
export async function downloadClip(url, videoId, signal) {
    const tries = [...new Set([url.replace(/^http:\/\//i, 'https://'), url])];
    let last = null;
    for (const u of tries) {
        try { return asVideo(await getVideo(u, signal)); }
        catch (e) { if (!(e instanceof BlockedDownload)) throw e; last = e; }
    }
    try { return asVideo(await fetchVideoContent(videoId, signal)); }
    catch (e) {
        if (signal && signal.aborted) throw new DOMException('Arrêt demandé', 'AbortError');
        throw new BlockedDownload((last && last.message) || e.message);
    }
}

// Durée, taille et présence d'un son, lues par le téléphone.
export async function probeClip(blob, fallbackSeconds = 0) {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true; v.preload = 'metadata'; v.playsInline = true;
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Clip illisible (délai dépassé)')), 20000);
            v.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
            v.onerror = () => { clearTimeout(timer); reject(new Error('Clip illisible sur ce téléphone')); };
            v.src = url;
        });
        const duration = isFinite(v.duration) && v.duration > 0 ? v.duration : fallbackSeconds;
        let hasAudio = false;
        try {
            const Ctx = self.OfflineAudioContext || self.webkitOfflineAudioContext;
            const buf = await new Ctx(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
            hasAudio = buf.duration > 0.1;
        } catch (e) { /* clip muet */ }
        return { duration: r3(duration), width: v.videoWidth, height: v.videoHeight, hasAudio };
    } finally {
        v.removeAttribute('src'); v.load();
        URL.revokeObjectURL(url);
    }
}

// Anime les plans de l'épisode. planIds : limiter à certains plans (même non cochés) ; force : nouveau
// clip même s'il est à jour. Les créations sont espacées ; les clips se préparent en parallèle chez Agnes.
// onUpdate(planId, { state: queued | spacing | creating | running | waiting | ok | error | stopped, … }).
export async function generateEpisodeClips({ project, characters, episode, planIds = null, force = false, signal = null, onUpdate = () => {} }) {
    if (!episode.analysis || !episode.analysis.ok) throw new Error('Corrigez le script avant d\'animer les plans');
    const ctrl = new AbortController();               // arrête aussi les suivis en cours (arrêt, clé refusée)
    const sig = ctrl.signal;
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const all = await clipStates(project, characters, episode);
    const targets = all.filter(s => planIds ? planIds.includes(s.plan.id) : s.animate);
    const summary = { generated: 0, reused: 0, upToDate: 0, failed: 0, resumed: 0, remote: 0, stopped: false, keyRefused: false };
    const fail = (id, e) => {
        if (e.name === 'AbortError') { summary.stopped = !summary.keyRefused; onUpdate(id, { state: 'stopped' }); return; }
        summary.failed++;
        onUpdate(id, { state: 'error', message: e.message });
        if (e.status === 401 || e.status === 403) { summary.keyRefused = true; ctrl.abort(); }
    };

    // Suivi d'une création jusqu'au clip enregistré.
    const follow = async (s, pending) => {
        const id = s.plan.id;
        let progress = 0;
        const tick = left => onUpdate(id, { state: 'running', progress, left });
        const first = Math.max(CLIP_TIMING.minFirstWait, estimateSeconds(pending.frames) * 0.8 - (Date.now() - pending.createdAt) / 1000);
        await pausableWait(first, sig, tick);
        for (let n = 0; n < CLIP_TIMING.maxPolls; n++) {
            if (n) await pausableWait(CLIP_TIMING.pollEvery, sig, tick);
            let st;
            try {
                st = await retrying(() => videoStatus(pending.videoId, sig), sig, (left, message) => onUpdate(id, { state: 'waiting', left, message }));
            } catch (e) {
                if (e.status === 404) {     // création oubliée par Agnes (trop ancienne)
                    await savePending(project.id, episode.id, id, null);
                    throw new AgnesError('Création introuvable chez Agnes : relancez ce plan');
                }
                throw e;
            }
            progress = st.progress;
            onUpdate(id, { state: 'running', progress });
            if (st.status === 'failed') {
                await savePending(project.id, episode.id, id, null);
                throw new AgnesError('Agnes n\'a pas pu animer ce plan (' + st.raw + ')');
            }
            if (st.status !== 'done') continue;
            onUpdate(id, { state: 'running', progress: 100, message: 'téléchargement' });
            recordTime(pending.frames, (Date.now() - pending.createdAt) / 1000);
            const remote = { ...pending, url: st.url, readyAt: Date.now() };
            let blob;
            try {
                blob = await retrying(() => downloadClip(st.url, pending.videoId, sig), sig, (left, message) => onUpdate(id, { state: 'waiting', left, message }));
            } catch (e) {
                if (!(e instanceof BlockedDownload)) throw e;
                // clip prêt chez Agnes mais non téléchargeable par l'appli : à télécharger puis importer
                await updateClip(project.id, episode.id, id, c => { c.pending = null; c.remote = remote; });
                summary.remote++;
                onUpdate(id, { state: 'remote' });
                return;
            }
            await saveClipBlob(project, episode, id, blob, remote);
            summary.generated++;
            onUpdate(id, { state: 'ok', generated: true });
            return;
        }
        throw new AgnesError('Agnes met trop longtemps : relancez plus tard (la création sera reprise)');
    };

    const follows = [];
    try {
        for (const s of targets) {
            const id = s.plan.id;
            if (sig.aborted) { summary.stopped = !summary.keyRefused; break; }
            if (s.req.error) { summary.failed++; onUpdate(id, { state: 'error', message: s.req.error }); continue; }
            if (!force && s.state === 'ok') { summary.upToDate++; onUpdate(id, { state: 'ok' }); continue; }
            try {
                await waitVisible(sig);
                if (!force) {
                    const cached = await findCachedAsset(project.id, s.req.hash, 'clip');
                    if (cached) { await setClipAsset(project.id, episode.id, id, cached); summary.reused++; onUpdate(id, { state: 'ok', reused: true }); continue; }
                }
                if (!force && s.state === 'remote') {      // nouvel essai de téléchargement, sans recréer
                    try {
                        const blob = await downloadClip(s.clip.remote.url, s.clip.remote.videoId, sig);
                        await saveClipBlob(project, episode, id, blob, s.clip.remote);
                        summary.generated++;
                        onUpdate(id, { state: 'ok', generated: true });
                    } catch (e) {
                        if (!(e instanceof BlockedDownload)) throw e;
                        summary.remote++;
                        onUpdate(id, { state: 'remote' });
                    }
                    continue;
                }
                let pending = !force && s.clip && s.clip.pending && s.clip.pending.hash === s.req.hash ? s.clip.pending : null;
                if (pending) summary.resumed++;
                else {
                    await waitSpacing(sig, left => onUpdate(id, { state: 'spacing', left }));
                    onUpdate(id, { state: 'creating' });
                    const shot = await getAsset(s.shotAssetId);
                    if (!shot) throw new AgnesError('Image du plan introuvable');
                    const image = await blobToDataUri(shot.blob);
                    const videoId = await retrying(() => createVideo({ prompt: s.req.prompt, negative: s.req.negative, image, frames: s.frames, signal: sig }),
                        sig, (left, message) => onUpdate(id, { state: 'waiting', left, message }));
                    lsSet(LAST_CREATE, String(Date.now()));
                    pending = { videoId, hash: s.req.hash, frames: s.frames, prompt: s.req.prompt, createdAt: Date.now() };
                    await savePending(project.id, episode.id, id, pending);
                }
                onUpdate(id, { state: 'running', progress: 0 });
                follows.push(follow(s, pending).catch(e => fail(id, e)));
            } catch (e) { fail(id, e); }
        }
        await Promise.all(follows);
    } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
    }
    if (signal && signal.aborted) summary.stopped = true;
    return summary;
}
