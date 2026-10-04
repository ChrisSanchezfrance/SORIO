// Drama — étape 6 : export MP4 1080×1920, 30 i/s, avec le son, et vignette « EP.x ».
//
// Tout se fait sur le téléphone : chaque image est dessinée par render.js (le même dessin que
// l'aperçu) et encodée par l'encodeur vidéo du téléphone (WebCodecs), plan par plan ; chaque plan
// encodé est gardé (étape 7 : reprise). Le son est mixé hors ligne par mix.js puis encodé, et
// mp4-muxer assemble le fichier MP4, écrit au fil de l'eau dans le stockage privé (OPFS).
// Codecs : H.264 + AAC si le téléphone sait les produire (le plus compatible avec TikTok,
// YouTube, Instagram…), sinon VP9 / AV1 + Opus, toujours dans un MP4.

import { Muxer, FileSystemWritableFileStreamTarget, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';
import { W, H, FPS, videoSegments } from './montage.js';
import { drawFrame, imagesAround } from './render.js';
import { scheduleMix, soundAssetIds } from './mix.js';
import { waitVisible } from './jobs.js';
import { hashString } from './parser.js';
import * as M from './model.js';
import { get, put, del, getByIndex } from './db.js';

export const SAMPLE_RATE = 48000;
export const VIDEO_BITRATE = 6_000_000;
export const AUDIO_BITRATE = 128_000;
const KEYFRAME_EVERY = FPS * 2;
const EXPORT_DIR = 'drama-exports';

const VIDEO_CANDIDATES = [
    { codec: 'avc1.640028', mux: 'avc', label: 'H.264' },
    { codec: 'avc1.4d0028', mux: 'avc', label: 'H.264' },
    { codec: 'avc1.42e028', mux: 'avc', label: 'H.264' },
    { codec: 'vp09.00.40.08', mux: 'vp9', label: 'VP9' },
    { codec: 'av01.0.08M.08', mux: 'av1', label: 'AV1' }
];
const AUDIO_CANDIDATES = [
    { codec: 'mp4a.40.2', mux: 'aac', label: 'AAC' },
    { codec: 'opus', mux: 'opus', label: 'Opus' }
];

export function canExport() {
    return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// Meilleurs codecs disponibles sur cet appareil.
export async function pickCodecs() {
    if (!canExport()) throw new Error('Ce navigateur ne sait pas encoder de vidéo (WebCodecs). Utilisez Chrome à jour sur Android.');
    let video = null, audio = null;
    for (const c of VIDEO_CANDIDATES) {
        const cfg = { codec: c.codec, width: W, height: H, bitrate: VIDEO_BITRATE, framerate: FPS };
        try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { video = { ...c, config: cfg }; break; } } catch (e) {}
    }
    for (const c of AUDIO_CANDIDATES) {
        const cfg = { codec: c.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE };
        try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) { audio = { ...c, config: cfg }; break; } } catch (e) {}
    }
    if (!video) throw new Error('Aucun encodeur vidéo disponible sur cet appareil');
    if (!audio) throw new Error('Aucun encodeur audio disponible sur cet appareil');
    return { video, audio, compatible: video.mux === 'avc' && audio.mux === 'aac' };
}

// Empreinte du montage : l'export est « à refaire » si elle change.
export function timelineHash(tl) {
    return hashString(JSON.stringify({ d: tl.duration, p: tl.plans, v: tl.voices.map(v => [v.assetId, v.start]), s: tl.sfx, m: tl.music, c: tl.cues, st: tl.settings }));
}

// ─── Fichiers exportés (stockage privé de l'appli) ────────────────
async function exportDir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(EXPORT_DIR, { create: true });
}
export async function getExportFile(name) {
    try { return await (await (await exportDir()).getFileHandle(name)).getFile(); } catch (e) { return null; }
}
export async function deleteExportFile(name) {
    try { await (await exportDir()).removeEntry(name); } catch (e) {}
}

// Cache d'images décodées pendant l'export (quelques plans seulement en mémoire).
function bitmapCache(max = 6) {
    const map = new Map();
    return {
        async ensure(ids) {
            for (const id of ids) {
                if (map.has(id)) { const b = map.get(id); map.delete(id); map.set(id, b); continue; }
                const a = await M.getAsset(id);
                map.set(id, a ? await createImageBitmap(a.blob) : null);
                while (map.size > max) {
                    const [k, b] = map.entries().next().value;
                    map.delete(k);
                    if (b && b.close) b.close();
                }
            }
        },
        get: id => map.get(id) || null,
        clear() { for (const b of map.values()) if (b && b.close) b.close(); map.clear(); }
    };
}

// Mixage complet de l'épisode, rendu hors ligne en stéréo 48 kHz.
export async function renderEpisodeAudio(tl) {
    const length = Math.max(1, Math.ceil(tl.duration * SAMPLE_RATE));
    const ac = new OfflineAudioContext(2, length, SAMPLE_RATE);
    const buffers = new Map();
    for (const id of soundAssetIds(tl)) {
        const a = await M.getAsset(id);
        if (a) { try { buffers.set(id, await ac.decodeAudioData(await a.blob.arrayBuffer())); } catch (e) {} }
    }
    scheduleMix(ac, ac.destination, tl, buffers, { offset: 0, when: 0 });
    return ac.startRendering();
}

const abortError = () => new DOMException('Export arrêté', 'AbortError');

// ─── Morceaux vidéo encodés (un par plan), gardés pour reprendre ───
const SEG_DIR = 'drama-segments';
const segName = (episodeId, planId) => episodeId + '-' + planId + '.bin';
async function segDir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(SEG_DIR, { create: true });
}
async function readSegFile(name) {
    try { return await (await (await segDir()).getFileHandle(name)).getFile(); } catch (e) { return null; }
}
async function writeSegFile(name, bytes) {
    const fh = await (await segDir()).getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
}
async function removeSegFile(name) { try { await (await segDir()).removeEntry(name); } catch (e) {} }

// Supprime les morceaux encodés d'un épisode (épisode supprimé, série supprimée).
export async function deleteEpisodeRenders(episodeId) {
    for (const r of await getByIndex('renders', 'episodeId', episodeId)) {
        await removeSegFile(r.file);
        await del('renders', r.id);
    }
}

const toB64 = buf => {
    if (!buf) return null;
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
};
const fromB64 = b64 => b64 ? Uint8Array.from(atob(b64), c => c.charCodeAt(0)) : undefined;

// Exporte l'épisode. Les plans déjà encodés avec le même rendu sont repris tels quels :
// un export arrêté, interrompu ou relancé après une petite modification ne réencode que le reste.
// onProgress({ phase: 'prep' | 'images' | 'son' | 'fin', done, total, reused }).
export async function exportEpisode({ tl, projectId, episodeId, fileName, signal = null, onProgress = () => {} }) {
    const codecs = await pickCodecs();
    const codecKey = codecs.video.codec + '|' + VIDEO_BITRATE + '|' + FPS;
    const segs = videoSegments(tl, codecKey);
    const total = segs.reduce((n, x) => n + x.frames, 0);
    let encoderError = null;
    let collecting = null;            // morceau en cours : { chunks: [{ t, d, k, data }] }
    let lastConfig = null;             // configuration de décodage fournie par l'encodeur
    const venc = new VideoEncoder({
        output: (chunk, meta) => {
            if (meta && meta.decoderConfig) {
                const c = meta.decoderConfig;
                const cs = c.colorSpace && (c.colorSpace.toJSON ? c.colorSpace.toJSON() : c.colorSpace);
                lastConfig = { codec: c.codec, codedWidth: c.codedWidth || W, codedHeight: c.codedHeight || H,
                    colorSpace: cs ? { primaries: cs.primaries, transfer: cs.transfer, matrix: cs.matrix, fullRange: cs.fullRange } : null,
                    description: c.description ? toB64(c.description) : null };
            }
            if (!collecting) return;
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            collecting.chunks.push({ t: chunk.timestamp, d: chunk.duration || Math.round(1e6 / FPS), k: chunk.type === 'key', data });
        },
        error: e => { encoderError = e; }
    });
    const audioChunks = [];
    const aenc = new AudioEncoder({ output: (chunk, meta) => audioChunks.push({ chunk, meta }), error: e => { encoderError = e; } });
    const images = bitmapCache();
    const check = () => {
        if (signal && signal.aborted) throw abortError();
        if (encoderError) throw new Error('Encodeur interrompu : ' + encoderError.message);
    };
    let writable = null, outName = null;
    const stats = { encoded: 0, reused: 0 };

    try {
        onProgress({ phase: 'prep', done: 0, total });
        venc.configure({ ...codecs.video.config, latencyMode: 'quality' });
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
        const ctx = canvas.getContext('2d');

        // 1. En-têtes de l'encodeur de cette session (une image d'essai) : un morceau n'est
        //    réutilisable que s'il a été encodé avec les mêmes en-têtes.
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const probe = new VideoFrame(canvas, { timestamp: 0, duration: Math.round(1e6 / FPS) });
        venc.encode(probe, { keyFrame: true });
        probe.close();
        await venc.flush();
        check();
        if (!lastConfig) lastConfig = { codec: codecs.video.codec, codedWidth: W, codedHeight: H, colorSpace: null, description: null };
        const description = JSON.stringify(lastConfig);    // les morceaux réutilisés doivent avoir la même

        // 2. Images, plan par plan
        let done = 0;
        for (const seg of segs) {
            const id = episodeId + ':' + seg.planId;
            const rec = await get('renders', id);
            if (rec && rec.hash === seg.hash && (rec.description || null) === description && await readSegFile(rec.file)) {
                done += seg.frames;
                stats.reused += seg.frames;
                onProgress({ phase: 'images', done, total, reused: stats.reused });
                continue;
            }
            collecting = { chunks: [] };
            for (let i = seg.i0; i < seg.i1; i++) {
                if (i % 15 === 0) await waitVisible(signal);
                check();
                const t = i / FPS;
                await images.ensure(imagesAround(tl, t));
                drawFrame(ctx, tl, t, images.get, { scale: 1 });
                const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
                venc.encode(frame, { keyFrame: i === seg.i0 || (i - seg.i0) % KEYFRAME_EVERY === 0 });
                frame.close();
                while (venc.encodeQueueSize > 4) { await new Promise(r => setTimeout(r, 5)); check(); }
                done++;
                stats.encoded++;
                if (i % 10 === 0 || i === seg.i1 - 1) onProgress({ phase: 'images', done, total, reused: stats.reused });
            }
            await venc.flush();
            check();
            const chunks = collecting.chunks;
            collecting = null;
            if (chunks.length !== seg.frames || !chunks[0].k) throw new Error('Morceau ' + seg.planId + ' incomplet');
            // morceau terminé : enregistré tout de suite (reprise possible à partir d'ici)
            const size = chunks.reduce((n, c) => n + c.data.length, 0);
            const bytes = new Uint8Array(size);
            let off = 0;
            const index = chunks.map(c => { bytes.set(c.data, off); const e = { t: c.t, d: c.d, k: c.k, o: off, s: c.data.length }; off += c.data.length; return e; });
            const file = segName(episodeId, seg.planId);
            await writeSegFile(file, bytes);
            await put('renders', { id, projectId, episodeId, planId: seg.planId, hash: seg.hash, codec: codecs.video.codec, description, file, index, createdAt: Date.now() });
        }

        // 3. Son : mixage hors ligne puis encodage
        onProgress({ phase: 'son', done: total, total, reused: stats.reused });
        const audio = await renderEpisodeAudio(tl);
        check();
        aenc.configure(codecs.audio.config);
        const block = 4800;
        const left = audio.getChannelData(0), right = audio.getChannelData(1);
        for (let i = 0; i < audio.length; i += block) {
            const n = Math.min(block, audio.length - i);
            const planar = new Float32Array(n * 2);
            planar.set(left.subarray(i, i + n), 0);
            planar.set(right.subarray(i, i + n), n);
            const data = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2,
                timestamp: Math.round(i / SAMPLE_RATE * 1e6), data: planar });
            aenc.encode(data);
            data.close();
        }
        await aenc.flush();
        check();

        // 4. Assemblage du MP4 à partir des morceaux (sans réencoder)
        onProgress({ phase: 'fin', done: total, total, reused: stats.reused });
        const useOpfs = !!(navigator.storage && navigator.storage.getDirectory);
        let target;
        if (useOpfs) {
            outName = fileName;
            writable = await (await (await exportDir()).getFileHandle(fileName, { create: true })).createWritable();
            target = new FileSystemWritableFileStreamTarget(writable);
        } else target = new ArrayBufferTarget();
        const muxer = new Muxer({
            target,
            video: { codec: codecs.video.mux, width: W, height: H, frameRate: FPS },
            audio: { codec: codecs.audio.mux, numberOfChannels: 2, sampleRate: SAMPLE_RATE },
            fastStart: false,
            firstTimestampBehavior: 'offset'
        });
        for (const { chunk, meta } of audioChunks) muxer.addAudioChunk(chunk, meta);
        let first = true;
        for (const seg of segs) {
            check();
            const rec = await get('renders', episodeId + ':' + seg.planId);
            const blob = await readSegFile(rec.file);
            if (!blob) throw new Error('Morceau ' + seg.planId + ' introuvable');
            const bytes = new Uint8Array(await blob.arrayBuffer());
            for (const e of rec.index) {
                const meta = first ? { decoderConfig: {
                    codec: lastConfig.codec, codedWidth: lastConfig.codedWidth, codedHeight: lastConfig.codedHeight,
                    ...(lastConfig.colorSpace ? { colorSpace: lastConfig.colorSpace } : {}),
                    ...(lastConfig.description ? { description: fromB64(lastConfig.description) } : {})
                } } : undefined;
                muxer.addVideoChunkRaw(bytes.subarray(e.o, e.o + e.s), e.k ? 'key' : 'delta', e.t, e.d, meta);
                first = false;
            }
        }
        muxer.finalize();
        let file;
        if (writable) {
            await writable.close();
            writable = null;
            file = await getExportFile(fileName);
        } else file = new File([target.buffer], fileName, { type: 'video/mp4' });

        // morceaux de plans qui n'existent plus dans l'épisode
        const keep = new Set(segs.map(x => x.planId));
        for (const r of await getByIndex('renders', 'episodeId', episodeId)) {
            if (!keep.has(r.planId)) { await removeSegFile(r.file); await del('renders', r.id); }
        }
        return { file, codecs: codecs.video.label + ' + ' + codecs.audio.label, compatible: codecs.compatible, frames: total, ...stats };
    } catch (e) {
        if (writable) { try { await writable.abort(); } catch (_) {} }
        if (outName) await deleteExportFile(outName);
        throw e;
    } finally {
        images.clear();
        try { if (venc.state !== 'closed') venc.close(); } catch (e) {}
        try { if (aenc.state !== 'closed') aenc.close(); } catch (e) {}
    }
}

// ─── Vignette « EP.x » (1080×1920, JPEG) ──────────────────────────
export async function renderThumbnail(tl, planId, { series = '', episode = 1, title = '' } = {}) {
    const plan = tl.plans.find(p => p.id === planId) || tl.plans.find(p => p.imageAssetId) || tl.plans[0];
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d');
    const images = bitmapCache(2);
    if (plan && plan.imageAssetId) await images.ensure([plan.imageAssetId]);
    // milieu du plan, sans sous-titre ni transition
    const still = { ...tl, settings: { ...tl.settings, subtitles: false } };
    if (plan) drawFrame(ctx, still, plan.start + Math.max(plan.transition.duration, plan.duration / 2), images.get, { scale: 1 });
    images.clear();

    const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const font = (weight, size) => weight + ' ' + size + 'px -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const write = (text, y, f, stroke) => {
        ctx.font = f;
        ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(text, W / 2, y);
        ctx.fillStyle = '#fff'; ctx.fillText(text, W / 2, y);
    };
    if (series) write(series.toUpperCase().slice(0, 40), H * 0.70, font('700', 46), 8);
    write('EP.' + episode, H * 0.80, font('900', 230), 18);
    if (title) {
        ctx.font = font('700', 70);
        let t = title;
        while (ctx.measureText(t).width > W * 0.88 && t.length > 4) t = t.slice(0, -2);
        write(t === title ? t : t.trimEnd() + '…', H * 0.875, font('700', 70), 10);
    }
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
        : await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
    return { blob, planId: plan ? plan.id : null };
}
