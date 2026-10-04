// Drama — mixage du montage (Web Audio) : voix, bruitages, musiques en boucle avec fondus
// et baisse automatique sous les voix. Sert à l'aperçu (AudioContext) et à l'export
// (OfflineAudioContext, étape 6).

import { musicEnvelope, envelopeAt } from './montage.js';

// Planifie le mixage à partir de `offset` secondes de l'épisode, joué à `when` (temps du contexte).
// buffers : Map assetId → AudioBuffer. opts.voiceGain / opts.sfxGain / opts.musicGain : niveaux (1 par défaut).
// Retourne une fonction stop().
export function scheduleMix(ac, destination, tl, buffers, { offset = 0, when = ac.currentTime, voiceGain = 1, sfxGain = 1, musicGain = 1 } = {}) {
    const nodes = [];
    const at = t => when + Math.max(0, t - offset);

    // maxDuration : son coupé au-delà (son d'un clip, limité à son plan)
    const play = (buffer, start, gainValue, maxDuration = Infinity) => {
        if (!buffer) return;
        const length = Math.min(buffer.duration, maxDuration);
        if (start + length <= offset) return;
        const src = ac.createBufferSource();
        src.buffer = buffer;
        const g = ac.createGain();
        g.gain.value = gainValue;
        src.connect(g).connect(destination);
        const into = Math.max(0, offset - start);
        src.start(at(start), into, length - into);
        nodes.push(src);
    };
    for (const v of tl.voices) if (v.assetId) play(buffers.get(v.assetId), v.start, voiceGain);
    for (const c of tl.clipAudio || []) play(buffers.get(c.assetId), c.start, voiceGain, c.duration);
    for (const x of tl.sfx) if (x.assetId) play(buffers.get(x.assetId), x.start, sfxGain * x.volume);

    for (const seg of tl.music) {
        const buffer = seg.assetId && buffers.get(seg.assetId);
        if (!buffer || seg.end <= offset) continue;
        const src = ac.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const g = ac.createGain();
        const pts = musicEnvelope(seg, tl.ducks, tl.settings);
        g.gain.setValueAtTime(envelopeAt(pts, offset) * musicGain, when);
        for (const p of pts) if (p.t > offset) g.gain.linearRampToValueAtTime(p.v * musicGain, at(p.t));
        src.connect(g).connect(destination);
        const into = Math.max(0, offset - seg.start) % buffer.duration;
        src.start(at(seg.start), into);
        src.stop(at(seg.end));
        nodes.push(src);
    }
    return () => nodes.forEach(n => { try { n.stop(); } catch (e) {} });
}

// Sons nécessaires au mixage.
export function soundAssetIds(tl) {
    return [...new Set([...tl.voices, ...tl.sfx, ...tl.music, ...(tl.clipAudio || [])].map(x => x.assetId).filter(Boolean))];
}
