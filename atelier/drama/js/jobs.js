// Drama — outils communs aux générations (images, voix) :
// pause quand l'appli est en arrière-plan, attentes interruptibles, conversions base64.

export const RETRY_WAITS = [10, 20, 40, 60, 90];     // secondes : erreurs temporaires et 429

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
const abortError = () => new DOMException('Arrêt demandé', 'AbortError');

// Attend que l'appli soit au premier plan (pause en arrière-plan, comme l'onglet Vidéos).
export function waitVisible(signal) {
    if (signal && signal.aborted) return Promise.reject(abortError());
    if (!isHidden()) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const done = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(abortError()); };
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
export async function pausableWait(seconds, signal, onTick) {
    let left = seconds;
    while (left > 0) {
        if (signal && signal.aborted) throw abortError();
        await waitVisible(signal);
        if (onTick) onTick(Math.ceil(left));
        await new Promise(r => setTimeout(r, 250));
        left -= 0.25;
    }
}

// Appel avec reprises automatiques pour les erreurs marquées « retryable » (429, 5xx, réseau).
export async function withRetries(fn, signal, onWait) {
    for (let attempt = 0; ; attempt++) {
        await waitVisible(signal);
        try { return await fn(); }
        catch (e) {
            if (e.name === 'AbortError' || !e.retryable || attempt >= RETRY_WAITS.length) throw e;
            const wait = Math.max(e.retryAfter || 0, RETRY_WAITS[attempt]);
            await pausableWait(wait, signal, left => onWait && onWait(left, e.message));
        }
    }
}

export const blobToDataUri = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
});

export function b64ToBlob(b64, defaultMime = 'application/octet-stream') {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(b64);
    const mime = m ? m[1] : defaultMime;
    const bin = atob(m ? m[2] : b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}
