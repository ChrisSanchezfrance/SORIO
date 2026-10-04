// Drama — étape 7 : rendu en lot avec reprise sur erreur.
// La file (épisodes à exporter et résultat de chacun) est gardée sur le téléphone : si l'appli
// est fermée ou plante, le lot se reprend là où il s'est arrêté. Chaque épisode a droit à un
// second essai en cas d'erreur ; les plans déjà encodés sont repris (export.js), donc un essai
// ou une reprise ne réencode que ce qui manque.

const KEY = 'drama_batch';
export const MAX_ATTEMPTS = 2;

export function loadBatch() {
    try { const b = JSON.parse(localStorage.getItem(KEY) || 'null'); return b && Array.isArray(b.ids) ? b : null; } catch (e) { return null; }
}
export function saveBatch(b) {
    try { if (b) localStorage.setItem(KEY, JSON.stringify(b)); else localStorage.removeItem(KEY); } catch (e) {}
}

export function newBatch(projectId, ids) {
    const b = { projectId, ids: [...ids], results: {}, active: true, startedAt: Date.now() };
    ids.forEach(id => { b.results[id] = { state: 'pending' }; });
    saveBatch(b);
    return b;
}

export const remaining = b => b.ids.filter(id => !['done'].includes((b.results[id] || {}).state));
export const doneCount = b => b.ids.filter(id => (b.results[id] || {}).state === 'done').length;

// Lot interrompu (appli fermée pendant le rendu) : un épisode resté « en cours » est à reprendre.
export function interrupted(b) {
    return !!(b && b.active && remaining(b).length);
}

// exportOne(id, signal, onProgress) exporte un épisode et renvoie { size, encoded, reused }.
// onUpdate(batch) est appelé à chaque changement d'état.
export async function runBatch(b, { exportOne, signal = null, onUpdate = () => {}, onProgress = () => {} }) {
    b.active = true;
    saveBatch(b);
    for (const id of b.ids) {
        const r = b.results[id] || (b.results[id] = { state: 'pending' });
        if (r.state === 'done') continue;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (signal && signal.aborted) break;
            r.state = 'running';
            r.attempt = attempt;
            r.message = attempt > 1 ? 'nouvel essai (les plans déjà encodés sont repris)' : '';
            saveBatch(b); onUpdate(b);
            try {
                const res = await exportOne(id, signal, p => onProgress(id, p));
                Object.assign(r, { state: 'done', message: '', size: res.size, encoded: res.encoded, reused: res.reused, at: Date.now() });
                saveBatch(b); onUpdate(b);
                break;
            } catch (e) {
                if (e.name === 'AbortError') {
                    r.state = 'stopped';
                    r.message = 'arrêté — reprise possible';
                    saveBatch(b); onUpdate(b);
                    return b;
                }
                r.state = 'error';
                r.message = e.message;
                saveBatch(b); onUpdate(b);
            }
        }
        if (signal && signal.aborted) break;
    }
    b.active = remaining(b).length > 0 && b.ids.some(id => ['stopped', 'pending', 'running'].includes(b.results[id].state));
    b.finishedAt = Date.now();
    saveBatch(b); onUpdate(b);
    return b;
}
