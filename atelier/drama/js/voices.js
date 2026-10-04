// Drama — étape 4 : doublage ElevenLabs, une prise de voix par réplique.
//
// Chaque réplique [VOIX] est dite par la voix de la fiche du personnage (réglages de la fiche,
// modèle de la série). Empreinte = modèle + voix + réglages + texte : une prise n'est refaite
// que si l'un d'eux change ; « Régénérer » propose une autre prise (4 gardées).
// Durée d'un plan = marge de début + répliques (+ pauses entre elles) + marge de fin ;
// 2,5 s sans réplique ; durée imposée par « duree: Ns » si présente.
//
// La partie « empreinte + minutage » est pure (testable avec Node).

import { hashString, fold, PLAN_LEAD, PLAN_TAIL, GAP_BETWEEN_LINES, MIN_VOICED_PLAN, DEFAULT_PLAN_SECONDS } from './parser.js';
import { get, put, getByIndex, newId } from './db.js';
import { gcShotAssets, getAsset, DEFAULT_VOICE, ELEVEN_MODELS } from './model.js';
import { synthesize, alignmentToWords } from './elevenlabs.js';
import { withRetries, waitVisible, b64ToBlob } from './jobs.js';
import { findCachedAsset } from './images.js';

export const MAX_TAKES = 4;
const r3 = n => Math.round(n * 1000) / 1000;
const WORDS_PER_SECOND = 2.6;   // estimation tant que la prise n'existe pas
const estimateLine = (text, speed = 1) => text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND / (speed || 1);

// ─── Répliques de l'épisode (pur) ─────────────────────────────────
export const lineId = (planId, index) => planId + ':' + index;

export function episodeLines(analysis) {
    const out = [];
    for (const p of (analysis && analysis.plans) || []) {
        p.voix.forEach((v, i) => out.push({ id: lineId(p.id, i), planId: p.id, index: i, perso: v.perso, ton: v.ton, texte: v.texte }));
    }
    return out;
}

export function buildVoiceRequest(project, characters, line) {
    const c = characters.find(x => fold(x.name) === fold(line.perso));
    if (!c) return { lineId: line.id, error: 'Fiche @' + line.perso + ' introuvable' };
    const v = { ...DEFAULT_VOICE, ...(c.voice || {}) };
    if (!v.voiceId) return { lineId: line.id, error: 'Choisissez une voix pour @' + c.name + ' (section Personnages)' };
    const modelId = ELEVEN_MODELS.some(m => m.id === project.voiceModel) ? project.voiceModel : ELEVEN_MODELS[0].id;
    const settings = { stability: v.stability, similarity: v.similarity, style: v.style, speed: v.speed };
    const text = line.texte;
    const hash = hashString(JSON.stringify(['tts', modelId, v.voiceId, settings.stability, settings.similarity, settings.style, settings.speed, text]));
    return { lineId: line.id, perso: c.name, text, voiceId: v.voiceId, voiceName: v.voiceName || v.voiceId, modelId, settings, hash };
}

// Minutage de l'épisode. durations : { lineId: secondes } des prises à jour.
// complete = toutes les répliques ont leur prise ; sinon les durées manquantes sont estimées.
export function computeTiming(analysis, durations = {}, characters = []) {
    const speedOf = name => { const c = characters.find(x => fold(x.name) === fold(name)); return (c && c.voice && c.voice.speed) || 1; };
    const plans = [];
    let t = 0, missing = 0, lines = 0;
    for (const p of (analysis && analysis.plans) || []) {
        const ls = p.voix.map((v, i) => {
            const id = lineId(p.id, i);
            const d = durations[id];
            lines++;
            if (d == null) missing++;
            return { id, perso: v.perso, duration: d != null ? r3(d) : null, estimate: r3(estimateLine(v.texte, speedOf(v.perso))) };
        });
        let start = PLAN_LEAD;
        for (const l of ls) { l.start = r3(start); start += (l.duration ?? l.estimate) + GAP_BETWEEN_LINES; }
        const voiced = ls.length ? PLAN_LEAD + ls.reduce((s, l) => s + (l.duration ?? l.estimate), 0) + GAP_BETWEEN_LINES * (ls.length - 1) + PLAN_TAIL : 0;
        const complete = ls.every(l => l.duration != null);
        let duration, mode;
        if (p.duration.mode === 'fixed') { duration = p.duration.seconds; mode = 'fixed'; }
        else if (!ls.length) { duration = DEFAULT_PLAN_SECONDS; mode = 'default'; }
        else { duration = Math.max(MIN_VOICED_PLAN, voiced); mode = complete ? 'audio' : 'estimate'; }
        plans.push({ id: p.id, start: r3(t), duration: r3(duration), mode, complete, overflow: mode === 'fixed' && voiced > duration + 0.01, lines: ls });
        t += duration;
    }
    return { plans, total: r3(t), complete: missing === 0, lines, voiced: lines - missing };
}

// ─── Prises enregistrées au micro ─────────────────────────────────
// Une prise au micro ne dépend que du texte de la réplique (pas de la voix ElevenLabs).
export const micHash = text => hashString(JSON.stringify(['micro', text]));

// Prise à jour : enregistrée au micro pour ce texte, ou générée avec la voix et les réglages actuels.
export function takeValid(take, req, line) {
    return !!(take && take.current && (take.hash === micHash(line.texte) || (!req.error && take.hash === req.hash)));
}

// ─── Stockage des prises ──────────────────────────────────────────
export const takeId = (episodeId, lid) => episodeId + ':' + lid;
export const getTake = (episodeId, lid) => get('takes', takeId(episodeId, lid));
export async function getTakes(episodeId) {
    const list = await getByIndex('takes', 'episodeId', episodeId);
    return new Map(list.map(t => [t.lineId, t]));
}

async function setTake(projectId, episodeId, line, asset) {
    const id = takeId(episodeId, line.id);
    const t = (await get('takes', id)) || { id, projectId, episodeId, lineId: line.id, planId: line.planId, versions: [] };
    t.versions = t.versions.filter(v => v !== asset.id).concat(asset.id);
    while (t.versions.length > MAX_TAKES) t.versions.shift();
    t.current = asset.id;
    t.hash = asset.hash;
    t.updatedAt = Date.now();
    await put('takes', t);
    await gcShotAssets(projectId);
    return t;
}

export async function selectTakeVersion(episodeId, lid, assetId) {
    const t = await getTake(episodeId, lid);
    if (!t || !t.versions.includes(assetId)) return null;
    const a = await getAsset(assetId);
    t.current = assetId;
    t.hash = a ? a.hash : t.hash;
    t.updatedAt = Date.now();
    return put('takes', t);
}

// État de chaque réplique (ok, cached, stale, missing, error) + minutage de l'épisode.
export async function voiceStates(project, characters, episode) {
    const lines = episodeLines(episode.analysis);
    const takes = await getTakes(episode.id);
    const states = [];
    const durations = {};
    for (const line of lines) {
        const req = buildVoiceRequest(project, characters, line);
        const take = takes.get(line.id) || null;
        let state, asset = null;
        if (takeValid(take, req, line)) {
            state = 'ok';
            asset = await getAsset(take.current);
            if (asset) durations[line.id] = asset.duration;
        }
        else if (req.error) state = 'error';
        else if (await findCachedAsset(project.id, req.hash, 'voice')) state = 'cached';
        else state = take && take.current ? 'stale' : 'missing';
        states.push({ line, req, take, state, duration: asset ? asset.duration : null, micro: !!(asset && asset.source === 'micro') });
    }
    return { states, timing: computeTiming(episode.analysis, durations, characters) };
}

// ─── Génération ───────────────────────────────────────────────────
// Durée exacte de l'audio (repli : fin du dernier mot de l'alignement).
async function audioDuration(blob, words) {
    try {
        const Ctx = self.OfflineAudioContext || self.webkitOfflineAudioContext;
        const buf = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
        return r3(buf.duration);
    } catch (e) {
        if (words.length) return r3(words[words.length - 1].e);
        throw new Error('Audio illisible');
    }
}

export async function generateEpisodeVoices({ project, characters, episode, lineIds = null, force = false, signal = null, onUpdate = () => {} }) {
    if (!episode.analysis || !episode.analysis.ok) throw new Error('Corrigez le script avant de générer les voix');
    const lines = episodeLines(episode.analysis).filter(l => !lineIds || lineIds.includes(l.id));
    const summary = { generated: 0, reused: 0, upToDate: 0, failed: 0, stopped: false };
    for (const line of lines) {
        if (signal && signal.aborted) { summary.stopped = true; break; }
        const req = buildVoiceRequest(project, characters, line);
        if (!force && takeValid(await getTake(episode.id, line.id), req, line)) { summary.upToDate++; onUpdate(line.id, { state: 'ok' }); continue; }
        if (req.error) { summary.failed++; onUpdate(line.id, { state: 'error', message: req.error }); continue; }
        try {
            await waitVisible(signal);
            if (!force) {
                const cached = await findCachedAsset(project.id, req.hash, 'voice');
                if (cached) { await setTake(project.id, episode.id, line, cached); summary.reused++; onUpdate(line.id, { state: 'ok', reused: true }); continue; }
            }
            onUpdate(line.id, { state: 'running' });
            const out = await withRetries(
                () => synthesize({ voiceId: req.voiceId, text: req.text, modelId: req.modelId, settings: req.settings, signal }),
                signal, (left, message) => onUpdate(line.id, { state: 'waiting', left, message }));
            const blob = b64ToBlob(out.audioBase64, 'audio/mpeg');
            const words = alignmentToWords(out.alignment);
            const duration = await audioDuration(blob, words);
            const asset = await put('assets', {
                id: newId('a'), projectId: project.id, kind: 'voice', episodeId: episode.id, lineId: line.id,
                hash: req.hash, voiceId: req.voiceId, model: req.modelId, text: req.text,
                mime: 'audio/mpeg', duration, words, blob, createdAt: Date.now()
            });
            await setTake(project.id, episode.id, line, asset);
            summary.generated++;
            onUpdate(line.id, { state: 'ok', generated: true });
        } catch (e) {
            if (e.name === 'AbortError') { summary.stopped = true; onUpdate(line.id, { state: 'stopped' }); break; }
            summary.failed++;
            onUpdate(line.id, { state: 'error', message: e.message });
            if (e.status === 401 || e.status === 403 || /épuisés/.test(e.message)) { summary.blocked = e.message; break; }
        }
    }
    return summary;
}

// Nombre de répliques à jour (liste des épisodes) — sans consulter le cache.
export async function voiceReadyCount(project, characters, episode) {
    const lines = episodeLines(episode.analysis);
    if (!lines.length) return { ready: 0, total: 0 };
    const takes = await getTakes(episode.id);
    let ready = 0;
    for (const l of lines) {
        const req = buildVoiceRequest(project, characters, l);
        const t = takes.get(l.id);
        if (takeValid(t, req, l)) ready++;
    }
    return { ready, total: lines.length };
}

// Enregistre une prise au micro comme nouvelle version de la réplique.
export async function saveMicTake(project, episode, lid, blob, duration) {
    const line = episodeLines(episode.analysis).find(l => l.id === lid);
    if (!line) throw new Error('Réplique introuvable');
    const asset = await put('assets', {
        id: newId('a'), projectId: project.id, kind: 'voice', source: 'micro', episodeId: episode.id, lineId: lid,
        hash: micHash(line.texte), text: line.texte, mime: blob.type || 'audio/wav', duration, words: null, blob, createdAt: Date.now()
    });
    return setTake(project.id, episode.id, line, asset);
}
