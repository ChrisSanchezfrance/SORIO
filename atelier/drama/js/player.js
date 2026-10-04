// Drama — aperçu du montage sur le téléphone : image animée + son, en temps réel.
// Les images sont chargées au fil de la lecture (jamais tout l'épisode en mémoire).

import * as M from './model.js';
import * as IMG from './images.js';
import * as VO from './voices.js';
import * as CL from './clips.js';
import { buildTimeline } from './montage.js';
import { drawFrame, imagesAround } from './render.js';
import { scheduleMix, soundAssetIds } from './mix.js';

// Rassemble tout ce qu'il faut pour monter l'épisode (images retenues, clips animés, prises à jour, sons importés).
export async function loadEpisodeTimeline(project, characters, episode) {
    const clips = await CL.timelineClips(project, characters, episode);
    const agnes = {};
    for (const [pid, c] of Object.entries(clips)) if (c.audio) agnes[pid] = c.duration;
    const { states, timing } = await VO.voiceStates(project, characters, episode, { agnes });
    const takes = {};
    for (const s of states) {
        if (s.state !== 'ok') continue;
        const a = await M.getAsset(s.take.current);
        if (a) takes[s.line.id] = { assetId: a.id, words: a.words || null };
    }
    const shots = {};
    for (const [planId, sh] of await IMG.getShots(episode.id)) if (sh.current) shots[planId] = sh.current;
    const library = await M.libraryIndex(project.id);
    return buildTimeline({ analysis: episode.analysis, timing, shots, takes, library, settings: project.montage || {}, clips });
}

// Durée d'un fichier audio (pour la bibliothèque sonore).
export async function audioFileDuration(blob) {
    const Ctx = self.OfflineAudioContext || self.webkitOfflineAudioContext;
    const buf = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
    return buf.duration;
}

const MAX_BITMAPS = 8;
const MAX_VIDEOS = 4;

export class Player {
    constructor(onUpdate = () => {}) {
        this.onUpdate = onUpdate;
        this.canvas = null;
        this.tl = null;
        this.t = 0;
        this.scale = 0.5;
        this.bitmaps = new Map();      // assetId → ImageBitmap (les plus récents)
        this.loading = new Map();
        this.buffers = new Map();      // assetId → AudioBuffer
        this.ac = null;
        this.playing = false;
        this.stopMix = null;
        this.raf = 0;
        this.videos = new Map();       // planId → { assetId, video, url, ready } (clips animés)
        this.usedVideos = new Set();
    }

    attach(canvas, tl) {
        const sameEpisode = this.tl && tl && this.tl.plans.length === tl.plans.length;
        if (this.playing) this.pause();
        this.canvas = canvas;
        this.tl = tl;
        if (!sameEpisode) this.t = 0;
        this.t = Math.min(this.t, tl ? tl.duration : 0);
        this.render();
    }

    async image(id) {
        if (this.bitmaps.has(id)) {
            const b = this.bitmaps.get(id);
            this.bitmaps.delete(id); this.bitmaps.set(id, b);       // récemment utilisé
            return b;
        }
        if (!this.loading.has(id)) {
            this.loading.set(id, (async () => {
                const a = await M.getAsset(id);
                const bmp = a ? await createImageBitmap(a.blob) : null;
                if (bmp) {
                    this.bitmaps.set(id, bmp);
                    while (this.bitmaps.size > MAX_BITMAPS) {
                        const [old, ob] = this.bitmaps.entries().next().value;
                        this.bitmaps.delete(old);
                        if (ob && ob.close) ob.close();
                    }
                }
                this.loading.delete(id);
                return bmp;
            })());
        }
        return this.loading.get(id);
    }

    // Vidéo du clip d'un plan animé (chargée à la demande, quelques-unes seulement en mémoire).
    clipVideo(plan) {
        let e = this.videos.get(plan.id);
        if (e && e.assetId !== plan.clip.assetId) { this.releaseVideo(plan.id); e = null; }
        if (e) { this.videos.delete(plan.id); this.videos.set(plan.id, e); return e; }
        const video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.preload = 'auto';
        e = { assetId: plan.clip.assetId, video, url: null, ready: false };
        this.videos.set(plan.id, e);
        const redraw = () => { if (!this.playing && this.videos.get(plan.id) === e) this.render(); };
        video.addEventListener('loadeddata', () => { e.ready = true; redraw(); });
        video.addEventListener('seeked', redraw);
        M.getAsset(plan.clip.assetId).then(a => {
            if (!a || this.videos.get(plan.id) !== e) return;
            e.url = URL.createObjectURL(a.blob);
            video.src = e.url;
        }).catch(() => {});
        while (this.videos.size > MAX_VIDEOS) this.releaseVideo(this.videos.keys().next().value);
        return e;
    }

    releaseVideo(planId) {
        const e = this.videos.get(planId);
        if (!e) return;
        this.videos.delete(planId);
        e.video.pause();
        e.video.removeAttribute('src');
        e.video.load();
        if (e.url) URL.revokeObjectURL(e.url);
    }

    // Image du clip au temps demandé : pendant la lecture la vidéo joue (recalée si elle dérive),
    // à l'arrêt elle est positionnée sur l'image exacte. null tant qu'elle n'est pas prête.
    getClip(plan, time) {
        const e = this.clipVideo(plan);
        this.usedVideos.add(plan.id);
        if (!e.ready) return null;
        const v = e.video;
        const running = this.playing && time < plan.clip.duration - 0.06;
        if (running) {
            if (v.paused) { if (Math.abs(v.currentTime - time) > 0.05) v.currentTime = time; v.play().catch(() => {}); }
            else if (Math.abs(v.currentTime - time) > 0.3) v.currentTime = time;
        } else {
            if (!v.paused) v.pause();
            if (Math.abs(v.currentTime - time) > 0.02 && !v.seeking) v.currentTime = time;
        }
        return v;
    }

    // Dessine l'image au temps courant ; charge les images voisines puis redessine si besoin.
    render() {
        if (!this.canvas || !this.tl) return null;
        const ctx = this.canvas.getContext('2d');
        this.usedVideos.clear();
        const info = drawFrame(ctx, this.tl, this.t, id => this.bitmaps.get(id) || null,
            { scale: this.scale, getClip: (plan, time) => this.getClip(plan, time) });
        for (const [pid, e] of this.videos) if (!this.usedVideos.has(pid) && !e.video.paused) e.video.pause();
        const missing = imagesAround(this.tl, this.t).filter(id => !this.bitmaps.has(id));
        if (missing.length) {
            Promise.all(missing.map(id => this.image(id))).then(() => { if (!this.playing) this.render(); });
        }
        this.onUpdate({ t: this.t, duration: this.tl.duration, playing: this.playing, plan: info ? this.tl.plans[info.planIndex].id : null });
        return info;
    }

    seek(t) {
        this.t = Math.max(0, Math.min(t, this.tl ? this.tl.duration : 0));
        if (this.playing) { this.pause(); this.play(); }
        else this.render();
    }

    async play() {
        if (this.playing || !this.tl) return;
        if (this.t >= this.tl.duration - 0.05) this.t = 0;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!this.ac) this.ac = new Ctx();
        if (this.ac.state === 'suspended') await this.ac.resume();
        const ids = soundAssetIds(this.tl).filter(id => !this.buffers.has(id));
        if (ids.length) {
            this.onUpdate({ t: this.t, duration: this.tl.duration, playing: false, loading: true });
            for (const id of ids) {
                const a = await M.getAsset(id);
                if (a) { try { this.buffers.set(id, await this.ac.decodeAudioData(await a.blob.arrayBuffer())); } catch (e) {} }
            }
        }
        await Promise.all(imagesAround(this.tl, this.t).map(id => this.image(id)));
        const when = this.ac.currentTime + 0.1;
        this.stopMix = scheduleMix(this.ac, this.ac.destination, this.tl, this.buffers, { offset: this.t, when });
        const t0 = when - this.t;
        this.playing = true;
        const tick = () => {
            if (!this.playing) return;
            this.t = Math.min(this.tl.duration, Math.max(0, this.ac.currentTime - t0));
            this.render();
            if (this.t >= this.tl.duration) { this.pause(); this.render(); return; }
            this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
    }

    pause() {
        if (this.stopMix) { this.stopMix(); this.stopMix = null; }
        cancelAnimationFrame(this.raf);
        this.playing = false;
        for (const e of this.videos.values()) e.video.pause();
        if (this.tl) this.onUpdate({ t: this.t, duration: this.tl.duration, playing: false });
    }

    destroy() {
        this.pause();
        for (const b of this.bitmaps.values()) if (b && b.close) b.close();
        this.bitmaps.clear();
        for (const pid of [...this.videos.keys()]) this.releaseVideo(pid);
        this.buffers.clear();
        if (this.ac) { this.ac.close().catch(() => {}); this.ac = null; }
        this.canvas = null;
        this.tl = null;
    }
}
