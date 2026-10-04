// Drama — enregistrement des répliques au micro du téléphone (alternative gratuite à ElevenLabs).
// L'enregistrement est converti en WAV mono, les silences de début et de fin sont retirés
// pour que la durée du plan corresponde à la réplique.

export const MAX_SECONDS = 30;
const THRESHOLD = 0.02;    // niveau considéré comme « voix » (≈ -34 dB)
const PAD = 0.08;          // marge gardée avant et après la voix (s)
const WINDOW = 0.01;       // fenêtre d'analyse (s)

// ─── Traitement (pur) ─────────────────────────────────────────────
// Début et fin (en échantillons) de la partie parlée ; null si rien d'audible.
export function speechBounds(samples, sampleRate, { threshold = THRESHOLD, pad = PAD } = {}) {
    const win = Math.max(1, Math.round(sampleRate * WINDOW));
    let first = -1, last = -1;
    for (let i = 0; i < samples.length; i += win) {
        let peak = 0;
        const end = Math.min(samples.length, i + win);
        for (let j = i; j < end; j++) { const v = Math.abs(samples[j]); if (v > peak) peak = v; }
        if (peak >= threshold) { if (first < 0) first = i; last = end; }
    }
    if (first < 0) return null;
    const p = Math.round(pad * sampleRate);
    return [Math.max(0, first - p), Math.min(samples.length, last + p)];
}

// WAV 16 bits mono.
export function encodeWav(samples, sampleRate) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
}

// ─── Enregistrement (navigateur) ──────────────────────────────────
function pickMime() {
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
}

export async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Ce navigateur ne peut pas enregistrer le micro');
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
        throw new Error(e && e.name === 'NotAllowedError'
            ? 'Micro refusé : autorisez le micro pour l\'appli (icône à gauche de l\'adresse, ou Paramètres → Applis → Chrome → Autorisations)'
            : 'Micro indisponible (' + (e && e.message || e) + ')');
    }
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    const chunks = [];
    rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    const stopped = new Promise(resolve => { rec.onstop = resolve; });
    rec.start(250);
    const release = () => stream.getTracks().forEach(t => t.stop());
    return {
        startedAt: Date.now(),
        async stop() {
            if (rec.state !== 'inactive') rec.stop();
            await stopped;
            release();
            return new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
        },
        cancel() { try { if (rec.state !== 'inactive') rec.stop(); } catch (e) {} release(); }
    };
}

// Enregistrement brut → WAV mono sans les silences de début et de fin.
export async function processRecording(blob) {
    const Ctx = self.OfflineAudioContext || self.webkitOfflineAudioContext;
    let buf;
    try { buf = await new Ctx(1, 1, 48000).decodeAudioData(await blob.arrayBuffer()); }
    catch (e) { throw new Error('Enregistrement illisible'); }
    const n = buf.length, ch = buf.numberOfChannels;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    const bounds = speechBounds(mono, buf.sampleRate);
    if (!bounds || (bounds[1] - bounds[0]) / buf.sampleRate < 0.25) throw new Error('Rien entendu : parlez plus près du micro');
    const part = mono.subarray(bounds[0], bounds[1]);
    return {
        blob: new Blob([encodeWav(part, buf.sampleRate)], { type: 'audio/wav' }),
        duration: Math.round(part.length / buf.sampleRate * 1000) / 1000,
        trimmed: Math.round((n - part.length) / buf.sampleRate * 100) / 100
    };
}
