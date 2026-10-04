// Drama — étape 3 : une image par plan (Agnes), avec cache et régénération d'un plan seul.
//
// Pour chaque plan : prompt = style verrouillé + décor + fiches des personnages visibles
// + description [IMAGE] ; images de référence = photos des personnages (+ image de style).
// Empreinte = modèle + taille + prompt + références : si rien n'a changé, l'image en cache
// est réutilisée sans appel à l'API. « Régénérer » force une nouvelle variante ; les
// 4 dernières versions d'un plan sont gardées.
//
// La partie « prompt + empreinte » est pure (testable avec Node) ; la génération
// utilise le navigateur (IndexedDB, canvas).

import { hashString, fold } from './parser.js';
import { get, put, getByIndex, newId } from './db.js';
import { gcShotAssets, getAsset } from './model.js';
import { generateImage, AgnesError } from './agnes.js';

export const SHOT_W = 1242, SHOT_H = 2208;   // 1080×1920 + 15 % de marge pour les zooms et panoramiques
export const MAX_REFS = 4;
export const MAX_VERSIONS = 4;
export const DEFAULT_IMAGE_SETTINGS = Object.freeze({ model: 'agnes-image-2.1-flash', size: '2K', refs: 'all' });
export const REF_MODES = [
    { id: 'all', name: 'Personnages + style (recommandé)' },
    { id: 'characters', name: 'Personnages seulement' },
    { id: 'none', name: 'Aucune (texte seul)' }
];
const RETRY_WAITS = [10, 20, 40, 60, 90];     // secondes, erreurs temporaires et 429
const TRANSFER_KEY = 'drama_agnes_transfer';  // 'b64' si les URL d'images ne sont pas téléchargeables

const sentence = s => { const t = String(s || '').trim(); return /[.!?…»"]$/.test(t) ? t : t + '.'; };
const NAME_TAG = /@([A-Za-zÀ-ÖØ-öø-ÿ0-9_-]+)/g;

// ─── Prompt + empreinte (pur) ─────────────────────────────────────
// refKeys : clé stable de chaque image de référence (identique après export/import) ;
// à défaut, l'identifiant de l'image.
export function buildImageRequest(project, characters, plan, settings = {}, refKeys = null) {
    const s = { ...DEFAULT_IMAGE_SETTINGS, ...(project.imageSettings || {}), ...settings };
    const byName = new Map(characters.map(c => [fold(c.name), c]));
    const visible = plan.persos.map(n => byName.get(fold(n))).filter(Boolean);
    const style = project.style || {};

    const refs = [];
    if (s.refs !== 'none') {
        for (const c of visible) {
            if (c.refImageId && refs.length < MAX_REFS && !refs.some(r => r.assetId === c.refImageId)) {
                refs.push({ assetId: c.refImageId, role: 'character', name: c.name });
            }
        }
        if (s.refs === 'all' && style.refImageId && refs.length < MAX_REFS) refs.push({ assetId: style.refImageId, role: 'style' });
    }
    const refNo = pred => { const i = refs.findIndex(pred); return i >= 0 ? i + 1 : 0; };

    const lines = ['Vertical 9:16 illustration: one single frame of a cinematic drama series made for mobile phones.'];
    if (style.text) lines.push('Art style, identical for the whole series: ' + sentence(style.text));
    const styleNo = refNo(r => r.role === 'style');
    if (styleNo) lines.push('Match the art style, colour palette, lighting and rendering of reference image ' + styleNo +
        ' (style only: do not copy its content or composition).');
    if (plan.decor) lines.push('Setting: ' + sentence(plan.decor));
    if (visible.length) {
        lines.push('Characters in this frame:');
        for (const c of visible) {
            const n = refNo(r => r.role === 'character' && r.name === c.name);
            lines.push('- ' + c.name + (c.desc ? ': ' + c.desc.replace(/[.\s]+$/, '') : '') +
                (n ? ' — same face, hair and outfit as reference image ' + n : '') + '.');
        }
    }
    lines.push('Scene: ' + sentence(String(plan.image || '').replace(NAME_TAG, '$1')));
    if (refs.length) lines.push('Create a new image of this scene: use the reference images only for identity and style, not for their composition or background.');
    lines.push('Composition: keep the main subjects in the central area with breathing room around the edges (the frame will be slowly zoomed and panned) and keep the bottom fifth free of important details (subtitles).');
    lines.push('No text, letters, captions, subtitles, speech bubbles, watermark or logo' +
        (style.negative ? '. Avoid: ' + String(style.negative).replace(/[.\s]+$/, '') : '') + '.');

    const prompt = lines.join('\n');
    const keyOf = id => (refKeys && refKeys[id]) || id;
    const hash = hashString(JSON.stringify([s.model, s.size, '9:16', prompt, refs.map(r => keyOf(r.assetId))]));
    return { planId: plan.id, prompt, refs, hash, model: s.model, size: s.size, ratio: '9:16' };
}

// Clés stables des images de référence de la série (style + photos des personnages).
export async function loadRefKeys(project, characters) {
    const ids = [project.style && project.style.refImageId, ...characters.map(c => c.refImageId)].filter(Boolean);
    const keys = {};
    for (const id of ids) {
        const a = await getAsset(id);
        keys[id] = (a && a.key) || id;
    }
    return keys;
}

// ─── Stockage des images de plans ─────────────────────────────────
export const shotId = (episodeId, planId) => episodeId + ':' + planId;
export const getShot = (episodeId, planId) => get('shots', shotId(episodeId, planId));
export async function getShots(episodeId) {
    const list = await getByIndex('shots', 'episodeId', episodeId);
    return new Map(list.map(sh => [sh.planId, sh]));
}

export async function findCachedAsset(projectId, hash) {
    const list = (await getByIndex('assets', 'hash', hash)).filter(a => a.projectId === projectId && a.kind === 'shot');
    return list.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

async function setShot(projectId, episodeId, planId, asset) {
    const id = shotId(episodeId, planId);
    const sh = (await get('shots', id)) || { id, projectId, episodeId, planId, versions: [] };
    sh.versions = sh.versions.filter(v => v !== asset.id).concat(asset.id);
    while (sh.versions.length > MAX_VERSIONS) sh.versions.shift();
    sh.current = asset.id;
    sh.hash = asset.hash;
    sh.updatedAt = Date.now();
    await put('shots', sh);
    await gcShotAssets(projectId);
    return sh;
}

// Choisit une version précédente / suivante d'un plan.
export async function selectShotVersion(episodeId, planId, assetId) {
    const sh = await getShot(episodeId, planId);
    if (!sh || !sh.versions.includes(assetId)) return null;
    const asset = await getAsset(assetId);
    sh.current = assetId;
    sh.hash = asset ? asset.hash : sh.hash;
    sh.updatedAt = Date.now();
    return put('shots', sh);
}

// État de chaque plan : ok (image à jour), stale (script/style modifié depuis),
// cached (une image identique existe déjà : réutilisée sans appel), missing.
export async function planStates(project, characters, episode) {
    const plans = (episode.analysis && episode.analysis.plans) || [];
    const shots = await getShots(episode.id);
    const keys = await loadRefKeys(project, characters);
    const out = [];
    for (const plan of plans) {
        const req = buildImageRequest(project, characters, plan, {}, keys);
        const shot = shots.get(plan.id) || null;
        let state;
        if (shot && shot.current && shot.hash === req.hash) state = 'ok';
        else if (await findCachedAsset(project.id, req.hash)) state = 'cached';
        else state = shot && shot.current ? 'stale' : 'missing';
        out.push({ plan, req, shot, state });
    }
    return out;
}

// Nombre d'images à jour (liste des épisodes) — sans consulter le cache.
export async function readyCount(project, characters, episode) {
    const plans = (episode.analysis && episode.analysis.plans) || [];
    if (!plans.length) return { ready: 0, total: 0 };
    const shots = await getShots(episode.id);
    const keys = await loadRefKeys(project, characters);
    let ready = 0;
    for (const p of plans) {
        const sh = shots.get(p.id);
        if (sh && sh.current && sh.hash === buildImageRequest(project, characters, p, {}, keys).hash) ready++;
    }
    return { ready, total: plans.length };
}

// ─── Génération ───────────────────────────────────────────────────
const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

// Attend que l'appli soit au premier plan (pause en arrière-plan, comme l'onglet Vidéos).
function waitVisible(signal) {
    if (!isHidden()) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const done = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(new DOMException('Arrêt demandé', 'AbortError')); };
        const onVis = () => { if (!isHidden()) done(); };
        const cleanup = () => {
            document.removeEventListener('visibilitychange', onVis);
            if (signal) signal.removeEventListener('abort', abort);
        };
        document.addEventListener('visibilitychange', onVis);
        if (signal) signal.addEventListener('abort', abort, { once: true });
    });
}

// Attente qui ne s'écoule que lorsque l'appli est visible.
async function pausableWait(seconds, signal, onTick) {
    let left = seconds;
    while (left > 0) {
        if (signal && signal.aborted) throw new DOMException('Arrêt demandé', 'AbortError');
        await waitVisible(signal);
        if (onTick) onTick(Math.ceil(left));
        await new Promise(r => setTimeout(r, 250));
        left -= 0.25;
    }
}

const blobToDataUri = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
});

function b64ToBlob(b64) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(b64);
    const mime = m ? m[1] : 'image/png';
    const bin = atob(m ? m[2] : b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

async function fetchImageBlob(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!blob.size) throw new Error('Image vide');
    return blob;
}

// Recadre au centre en 9:16 et ré-encode en JPEG 1242×2208 (taille de travail du montage).
export async function normalizeShot(blob) {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = SHOT_W; canvas.height = SHOT_H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const scale = Math.max(SHOT_W / bmp.width, SHOT_H / bmp.height);
    const w = bmp.width * scale, h = bmp.height * scale;
    ctx.drawImage(bmp, (SHOT_W - w) / 2, (SHOT_H - h) / 2, w, h);
    const source = { width: bmp.width, height: bmp.height };
    bmp.close();
    const out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!out) throw new Error('Conversion de l\'image impossible');
    return { blob: out, source };
}

function getTransferMode() { try { return localStorage.getItem(TRANSFER_KEY) === 'b64' ? 'b64' : 'url'; } catch (e) { return 'url'; } }
function setTransferMode(m) { try { localStorage.setItem(TRANSFER_KEY, m); } catch (e) {} }

// Un appel Agnes avec reprises (erreurs temporaires, 429) et repli en base64 si
// l'image renvoyée par URL ne peut pas être téléchargée par le navigateur.
async function requestImage(req, refsData, signal, onStatus) {
    let attempt = 0, triedB64 = getTransferMode() === 'b64';
    for (;;) {
        await waitVisible(signal);
        try {
            const base64 = getTransferMode() === 'b64';
            onStatus({ state: 'running' });
            const out = await generateImage({ model: req.model, prompt: req.prompt, size: req.size, ratio: req.ratio,
                images: refsData, base64, signal });
            if (out.b64) return b64ToBlob(out.b64);
            try {
                return await fetchImageBlob(out.url, signal);
            } catch (e) {
                if (signal && signal.aborted) throw new DOMException('Arrêt demandé', 'AbortError');
                if (triedB64) throw new AgnesError('Image générée mais impossible à récupérer (' + e.message + ')');
                // L'hébergeur des images bloque le téléchargement direct : on passe en base64 pour la suite.
                setTransferMode('b64');
                triedB64 = true;
                continue;
            }
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            if (!e.retryable || attempt >= RETRY_WAITS.length) throw e;
            const wait = Math.max(e.retryAfter || 0, RETRY_WAITS[attempt++]);
            await pausableWait(wait, signal, left => onStatus({ state: 'waiting', message: e.message, left }));
        }
    }
}

// Génère les images de l'épisode. planIds : limiter à certains plans ; force : nouvelle
// variante même si l'image est à jour (« Régénérer »). onUpdate(planId, {state, …}).
export async function generateEpisodeImages({ project, characters, episode, planIds = null, force = false, signal = null, onUpdate = () => {} }) {
    if (!episode.analysis || !episode.analysis.ok) throw new Error('Corrigez le script avant de générer les images');
    const plans = episode.analysis.plans.filter(p => !planIds || planIds.includes(p.id));
    const refCache = new Map();
    const keys = await loadRefKeys(project, characters);
    const summary = { generated: 0, reused: 0, upToDate: 0, failed: 0, stopped: false };

    for (const plan of plans) {
        if (signal && signal.aborted) { summary.stopped = true; break; }
        const req = buildImageRequest(project, characters, plan, {}, keys);
        try {
            await waitVisible(signal);
            if (!force) {
                const shot = await getShot(episode.id, plan.id);
                if (shot && shot.current && shot.hash === req.hash) { summary.upToDate++; onUpdate(plan.id, { state: 'ok' }); continue; }
                const cached = await findCachedAsset(project.id, req.hash);
                if (cached) {
                    await setShot(project.id, episode.id, plan.id, cached);
                    summary.reused++;
                    onUpdate(plan.id, { state: 'ok', reused: true });
                    continue;
                }
            }
            const refsData = [];
            for (const r of req.refs) {
                if (!refCache.has(r.assetId)) {
                    const a = await getAsset(r.assetId);
                    refCache.set(r.assetId, a ? await blobToDataUri(a.blob) : null);
                }
                if (refCache.get(r.assetId)) refsData.push(refCache.get(r.assetId));
            }
            const raw = await requestImage(req, refsData, signal, st => onUpdate(plan.id, st));
            const { blob, source } = await normalizeShot(raw);
            const asset = await put('assets', {
                id: newId('a'), projectId: project.id, kind: 'shot', episodeId: episode.id, planId: plan.id,
                hash: req.hash, model: req.model, size: req.size, prompt: req.prompt,
                mime: 'image/jpeg', width: SHOT_W, height: SHOT_H, source, blob, createdAt: Date.now()
            });
            await setShot(project.id, episode.id, plan.id, asset);
            summary.generated++;
            onUpdate(plan.id, { state: 'ok', generated: true });
        } catch (e) {
            if (e.name === 'AbortError') { summary.stopped = true; onUpdate(plan.id, { state: 'stopped' }); break; }
            summary.failed++;
            onUpdate(plan.id, { state: 'error', message: e.message });
            if (e.status === 401 || e.status === 403) { summary.keyRefused = true; break; }   // clé refusée : inutile de continuer
        }
    }
    return summary;
}
