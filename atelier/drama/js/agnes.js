// Drama — client Agnes AI pour les images
// POST https://apihub.agnes-ai.com/v1/images/generations (format compatible OpenAI)
//   { model, prompt, size: '1K'|'2K'…, ratio: '9:16', image: [URL ou data URI…],
//     extra_body: { response_format: 'url' } }   ou   return_base64: true
//   → { created, data: [{ url | b64_json, revised_prompt }] }
// La clé est celle de l'onglet Vidéos (même stockage local).

export const AGNES_BASE = 'https://apihub.agnes-ai.com/v1';
export const AGNES_KEY_STORAGE = 'agnes_api_key';

export const IMAGE_MODELS = [
    { id: 'agnes-image-2.1-flash', name: 'Agnes Image 2.1 Flash (recommandé)' },
    { id: 'agnes-image-2.5-flash', name: 'Agnes Image 2.5 Flash (plus récent)' },
    { id: 'agnes-image-2.0-flash', name: 'Agnes Image 2.0 Flash' }
];
export const IMAGE_SIZES = [
    { id: '2K', name: '2K — 1472×2624, qualité (recommandé)' },
    { id: '1K', name: '1K — 736×1312, rapide (brouillon)' }
];

export class AgnesError extends Error {
    constructor(message, { status = 0, retryable = false, retryAfter = 0 } = {}) {
        super(message);
        this.status = status;
        this.retryable = retryable;
        this.retryAfter = retryAfter;
    }
}

export function getAgnesKey() {
    try { return (localStorage.getItem(AGNES_KEY_STORAGE) || '').trim(); } catch (e) { return ''; }
}

export async function generateImage({ model, prompt, size = '2K', ratio = '9:16', images = [], base64 = false,
    signal = null, timeoutMs = 240000 }) {
    const key = getAgnesKey();
    if (!key) throw new AgnesError('Ajoutez votre clé Agnes dans l\'onglet Vidéos', { status: 401 });

    const body = { model, prompt, size, ratio };
    if (images.length) body.image = images;
    if (base64) { body.return_base64 = true; body.extra_body = { response_format: 'b64_json' }; }
    else body.extra_body = { response_format: 'url' };

    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) {
        if (signal.aborted) ctrl.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }

    let res;
    try {
        res = await fetch(AGNES_BASE + '/images/generations', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
    } catch (e) {
        if (signal && signal.aborted) throw new DOMException('Arrêt demandé', 'AbortError');
        throw new AgnesError(timedOut ? 'Agnes ne répond pas (délai dépassé)' : 'Réseau indisponible', { retryable: true });
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }

    if (res.status === 401 || res.status === 403) {
        throw new AgnesError('Clé Agnes refusée', { status: res.status });
    }
    if (res.status === 429) {
        const ra = parseFloat(res.headers.get('retry-after') || '0');
        throw new AgnesError('Agnes demande de patienter (trop de demandes)', { status: 429, retryable: true, retryAfter: ra > 0 ? ra : 0 });
    }
    if (!res.ok) {
        let msg = 'erreur ' + res.status;
        try {
            const t = await res.text();
            try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error)) || j.message || j.detail || t; }
            catch (_) { msg = t || msg; }
        } catch (_) {}
        throw new AgnesError('Agnes : ' + String(msg).slice(0, 200), { status: res.status, retryable: res.status >= 500 });
    }

    let d;
    try { d = await res.json(); } catch (e) { throw new AgnesError('Réponse Agnes illisible', { retryable: true }); }
    const item = (Array.isArray(d.data) && d.data[0]) || d;
    const url = item.url || item.image_url || null;
    const b64 = item.b64_json || item.base64 || null;
    if (!url && !b64) throw new AgnesError('Réponse Agnes sans image', { retryable: true });
    return { url, b64, revisedPrompt: item.revised_prompt || null };
}
