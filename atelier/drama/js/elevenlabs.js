// Drama — client ElevenLabs
// Étape 1 : clé API et liste des voix du compte (avec extrait d'écoute gratuit).
// La synthèse des répliques arrive à l'étape 4.

export const ELEVEN_API = 'https://api.elevenlabs.io/v1';
const KEY_STORAGE = 'drama_elevenlabs_key';

export function getKey() {
    try { return (localStorage.getItem(KEY_STORAGE) || '').trim(); } catch (e) { return ''; }
}
export function setKey(key) {
    try {
        const k = String(key || '').trim();
        if (k) localStorage.setItem(KEY_STORAGE, k); else localStorage.removeItem(KEY_STORAGE);
    } catch (e) {}
}

let voicesCache = null;

export async function listVoices({ force = false } = {}) {
    if (voicesCache && !force) return voicesCache;
    const key = getKey();
    if (!key) throw new Error('Ajoutez d\'abord votre clé ElevenLabs');
    let res;
    try {
        res = await fetch(ELEVEN_API + '/voices', { headers: { 'xi-api-key': key } });
    } catch (e) {
        throw new Error('ElevenLabs injoignable (réseau)');
    }
    if (res.status === 401) throw new Error('Clé ElevenLabs refusée');
    if (!res.ok) throw new Error('ElevenLabs : erreur ' + res.status);
    const data = await res.json();
    voicesCache = (data.voices || []).map(v => ({
        voiceId: v.voice_id,
        name: v.name || v.voice_id,
        category: v.category || '',
        previewUrl: v.preview_url || '',
        labels: v.labels || {}
    })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return voicesCache;
}

export function describeVoice(v) {
    const l = v.labels || {};
    return [l.gender, l.age, l.accent, l.description || l.descriptive, l.use_case]
        .filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ');
}

// ─── Étape 4 : synthèse d'une réplique ────────────────────────────
// POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128
//   { text, model_id, voice_settings: { stability, similarity_boost, style, use_speaker_boost, speed } }
//   → { audio_base64, alignment: { characters[], character_start_times_seconds[], character_end_times_seconds[] } }
export const OUTPUT_FORMAT = 'mp3_44100_128';

// Refus connus d'ElevenLabs (champ detail.status de la réponse), expliqués en français.
const REFUSALS = {
    detected_unusual_activity: 'ElevenLabs a bloqué l\'offre gratuite (« activité inhabituelle ») : cela arrive avec un VPN, un proxy ou plusieurs comptes gratuits. Désactivez le VPN, ou passez à un abonnement payant.',
    missing_permissions: 'Votre clé ElevenLabs n\'a pas le droit « Text to Speech » : sur elevenlabs.io → Developers → API Keys, modifiez la clé et autorisez « Text to Speech ».',
    invalid_api_key: 'Clé ElevenLabs invalide : recopiez-la depuis elevenlabs.io → Developers → API Keys.',
    payment_required: 'Cette voix demande un abonnement ElevenLabs payant pour l\'API : choisissez une voix « premade » ou passez à un abonnement.',
    paid_plan_required: 'Cette voix demande un abonnement ElevenLabs payant pour l\'API : choisissez une voix « premade » ou passez à un abonnement.',
    voice_not_found: 'Voix introuvable sur votre compte ElevenLabs : choisissez-en une autre dans la fiche du personnage.'
};

export class ElevenError extends Error {
    constructor(message, { status = 0, retryable = false, retryAfter = 0, code = '' } = {}) {
        super(message);
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.retryAfter = retryAfter;
    }
}

export async function synthesize({ voiceId, text, modelId, settings = {}, signal = null, timeoutMs = 120000 }) {
    const key = getKey();
    if (!key) throw new ElevenError('Ajoutez votre clé ElevenLabs (en haut de l\'onglet Drama)', { status: 401 });
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    let res;
    try {
        res = await fetch(ELEVEN_API + '/text-to-speech/' + encodeURIComponent(voiceId) + '/with-timestamps?output_format=' + OUTPUT_FORMAT, {
            method: 'POST',
            headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text, model_id: modelId,
                voice_settings: {
                    stability: settings.stability, similarity_boost: settings.similarity,
                    style: settings.style, use_speaker_boost: true, speed: settings.speed
                }
            }),
            signal: ctrl.signal
        });
    } catch (e) {
        if (signal && signal.aborted) throw new DOMException('Arrêt demandé', 'AbortError');
        throw new ElevenError(timedOut ? 'ElevenLabs ne répond pas (délai dépassé)' : 'Réseau indisponible', { retryable: true });
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }

    if (!res.ok) {
        let detail = {};
        try { const j = await res.json(); detail = j.detail || j; } catch (e) {}
        const code = String(detail.status || detail.code || '');
        const msg = String(detail.message || (typeof detail === 'string' ? detail : '') || ('erreur ' + res.status)).slice(0, 200);
        if (code === 'quota_exceeded') throw new ElevenError('Crédits ElevenLabs épuisés', { status: res.status });
        const known = REFUSALS[code];
        if (known) throw new ElevenError(known, { status: res.status, code });
        if (res.status === 401 || res.status === 403) {
            throw new ElevenError('ElevenLabs refuse la synthèse' + (msg ? ' : « ' + msg + ' »' : ''), { status: res.status, code });
        }
        if (res.status === 404 || code === 'voice_not_found') throw new ElevenError('Voix introuvable sur votre compte ElevenLabs', { status: res.status });
        if (res.status === 429) {
            const ra = parseFloat(res.headers.get('retry-after') || '0');
            throw new ElevenError('ElevenLabs demande de patienter', { status: 429, retryable: true, retryAfter: ra > 0 ? ra : 0 });
        }
        throw new ElevenError('ElevenLabs : ' + msg, { status: res.status, retryable: res.status >= 500 });
    }
    let d;
    try { d = await res.json(); } catch (e) { throw new ElevenError('Réponse ElevenLabs illisible', { retryable: true }); }
    if (!d.audio_base64) throw new ElevenError('Réponse ElevenLabs sans audio', { retryable: true });
    return { audioBase64: d.audio_base64, alignment: d.alignment || d.normalized_alignment || null };
}

// Regroupe l'alignement par caractère en mots horodatés : [{ w, s, e }] (secondes).
export function alignmentToWords(al) {
    if (!al || !Array.isArray(al.characters)) return [];
    const chars = al.characters, st = al.character_start_times_seconds || [], en = al.character_end_times_seconds || [];
    const words = [];
    let cur = null;
    for (let i = 0; i < chars.length; i++) {
        if (/\s/.test(chars[i])) { if (cur) { words.push(cur); cur = null; } continue; }
        if (!cur) cur = { w: '', s: st[i] ?? 0, e: en[i] ?? 0 };
        cur.w += chars[i];
        cur.e = en[i] ?? cur.e;
    }
    if (cur) words.push(cur);
    return words.map(x => ({ w: x.w, s: Math.round(x.s * 1000) / 1000, e: Math.round(x.e * 1000) / 1000 }));
}
