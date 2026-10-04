// Drama — stockage local (IndexedDB)
// Magasins : projets, personnages, épisodes, médias (images et sons en Blob),
// « shots » (image retenue pour chaque plan d'un épisode, avec ses versions) et
// « takes » (prise de voix retenue pour chaque réplique, avec ses versions).
// Tout reste sur le téléphone ; rien n'est envoyé ailleurs.

export const DB_NAME = 'drama_studio';
export const DB_VERSION = 3;
export const STORES = ['projects', 'characters', 'episodes', 'assets', 'shots', 'takes'];

let dbPromise = null;

export function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in self)) { reject(new Error('IndexedDB indisponible')); return; }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('projects')) {
                db.createObjectStore('projects', { keyPath: 'id' });
            }
            for (const name of ['characters', 'episodes', 'assets']) {
                if (!db.objectStoreNames.contains(name)) {
                    const store = db.createObjectStore(name, { keyPath: 'id' });
                    store.createIndex('projectId', 'projectId', { unique: false });
                }
            }
            // v2 : cache d'images par empreinte + image retenue par plan
            const assets = req.transaction.objectStore('assets');
            if (!assets.indexNames.contains('hash')) assets.createIndex('hash', 'hash', { unique: false });
            // v2 : images des plans ; v3 : prises de voix des répliques
            for (const name of ['shots', 'takes']) {
                if (!db.objectStoreNames.contains(name)) {
                    const store = db.createObjectStore(name, { keyPath: 'id' });
                    store.createIndex('projectId', 'projectId', { unique: false });
                    store.createIndex('episodeId', 'episodeId', { unique: false });
                }
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            // une autre fenêtre de l'appli a une version plus récente : on se ferme proprement
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        req.onerror = () => reject(req.error || new Error('Ouverture de la base impossible'));
        req.onblocked = () => reject(new Error('Base bloquée : fermez les autres onglets de l\'appli'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
}

// Exécute fn(stores) dans une transaction ; résout avec la valeur retournée
// (ou le résultat de la requête IDB retournée) une fois la transaction validée.
export async function tx(storeNames, mode, fn) {
    const db = await openDb();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new Promise((resolve, reject) => {
        const t = db.transaction(names, mode);
        const stores = {};
        names.forEach(n => { stores[n] = t.objectStore(n); });
        let out;
        try { out = fn(names.length === 1 ? stores[names[0]] : stores); }
        catch (e) { try { t.abort(); } catch (_) {} reject(e); return; }
        t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Transaction annulée'));
    });
}

export const get = (store, id) => tx(store, 'readonly', s => s.get(id));
export const put = (store, value) => tx(store, 'readwrite', s => s.put(value)).then(() => value);
export const del = (store, id) => tx(store, 'readwrite', s => s.delete(id));
export const getAll = (store) => tx(store, 'readonly', s => s.getAll());
export const getByIndex = (store, index, value) =>
    tx(store, 'readonly', s => s.index(index).getAll(value));
export const getByProject = (store, projectId) => getByIndex(store, 'projectId', projectId);

export function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
    }
}
