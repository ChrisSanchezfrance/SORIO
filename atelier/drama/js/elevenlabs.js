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
