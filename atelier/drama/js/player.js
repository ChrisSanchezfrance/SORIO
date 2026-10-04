// Drama — aperçu du montage sur le téléphone : image animée + son, en temps réel.
// Les images sont chargées au fil de la lecture (jamais tout l'épisode en mémoire).

import * as M from './model.js';
import * as IMG from './images.js';
import * as VO from './voices.js';
import { buildTimeline } from './montage.js';
import { drawFrame, imagesAround } from './render.js';
import { scheduleMix, soundAssetIds } from './mix.js';

// Rassemble tout ce qu'il faut pour monter l'épisode (images retenues, prises à jour, sons importés).
export async function loadEpisodeTimeline(project, characters, episode) {
    const { states, timing } = await VO.voiceStates(project, characters, episode);
    const takes = {};
    for (const s of states) {
        if (s.state !== 'ok') continue;
        const a = await M.getAsset(s.take.current);
        if (a) takes[s.line.id] = { assetId: a.id, words: a.words || null };
    }
    const shots = {};
    for (const [planId, sh] of await IMG.getShots(episode.id)) if (sh.current) shots[planId] = sh.current;
    const library = await M.libraryIndex(project.id);
    return buildTimeline({ analysis: episode.analysis, timing, shots, takes, library, settings: project.montage || {} });
}

// Durée d'un fichier audio (pour la bibliothèque sonore).
export async function audioFileDuration(blob) {
    const Ctx = self.OfflineAudioContext || self.webkitOfflineAudioContext;
    const buf = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
    return buf.duration;
}

const MAX_BITMAPS = 8;

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

    // Dessine l'image au temps courant ; charge les images voisines puis redessine si besoin.
    render() {
        if (!this.canvas || !this.tl) return null;
        const ctx = this.canvas.getContext('2d');
        const info = drawFrame(ctx, this.tl, this.t, id => this.bitmaps.get(id) || null, { scale: this.scale });
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
        if (this.tl) this.onUpdate({ t: this.t, duration: this.tl.duration, playing: false });
    }

    destroy() {
        this.pause();
        for (const b of this.bitmaps.values()) if (b && b.close) b.close();
        this.bitmaps.clear();
        this.buffers.clear();
        if (this.ac) { this.ac.close().catch(() => {}); this.ac = null; }
        this.canvas = null;
        this.tl = null;
    }
}
