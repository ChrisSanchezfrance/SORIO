// Drama — modèle « projet série »
// Projet : style verrouillé (texte, interdits, image de référence, graine).
// Personnage : @Nom unique dans le projet, description, image de référence, voix ElevenLabs.
// Épisode : numéro, titre, script balisé (analysé à l'étape 2).

import { tx, get, put, getAll, getByProject, newId, requestPersistentStorage } from './db.js';

export const FORMAT = { ratio: '9:16', width: 1080, height: 1920, fps: 30 };
export const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9_-]{1,30}$/;
export const REF_IMAGE_MAX = 1536;

export const DEFAULT_VOICE = Object.freeze({
    voiceId: '', voiceName: '',
    stability: 0.5, similarity: 0.75, style: 0, speed: 1
});
export const ELEVEN_MODELS = [
    { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (qualité, recommandé)' },
    { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5 (rapide, moins cher)' },
    { id: 'eleven_flash_v2_5', name: 'Flash v2.5 (le plus rapide)' }
];

export class DramaError extends Error {}

const now = () => Date.now();
const clamp = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
export const normalizeName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ─── Projets ──────────────────────────────────────────────────────
export async function listProjects() {
    const list = await getAll('projects');
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getProject = id => get('projects', id);

export async function createProject({ name, styleText = '', styleNegative = '' } = {}) {
    const clean = String(name || '').trim();
    if (!clean) throw new DramaError('Donnez un nom à la série');
    const p = {
        id: newId('p'), name: clean.slice(0, 80),
        createdAt: now(), updatedAt: now(),
        format: { ...FORMAT },
        style: {
            text: String(styleText).trim(), negative: String(styleNegative).trim(),
            refImageId: null, seed: Math.floor(Math.random() * 2147483647),
            locked: false, lockedAt: null
        },
        voiceModel: ELEVEN_MODELS[0].id,
        language: 'fr'
    };
    requestPersistentStorage();
    return put('projects', p);
}

const STYLE_FIELDS = ['text', 'negative', 'refImageId', 'seed'];

export async function updateProject(id, patch) {
    const p = await getProject(id);
    if (!p) throw new DramaError('Projet introuvable');
    if (patch.style) {
        const touchesLocked = STYLE_FIELDS.some(k => k in patch.style && patch.style[k] !== p.style[k]);
        if (p.style.locked && touchesLocked) {
            throw new DramaError('Le style est verrouillé : déverrouillez-le pour le modifier');
        }
        if (p.style.refImageId && 'refImageId' in patch.style && patch.style.refImageId !== p.style.refImageId) {
            await deleteAsset(p.style.refImageId);
        }
        const { locked, lockedAt, ...rest } = patch.style;
        p.style = { ...p.style, ...rest };
        if ('seed' in rest) p.style.seed = Math.floor(clamp(rest.seed, 0, 2147483647, p.style.seed));
    }
    if ('name' in patch) {
        const clean = String(patch.name || '').trim();
        if (!clean) throw new DramaError('Donnez un nom à la série');
        p.name = clean.slice(0, 80);
    }
    if ('voiceModel' in patch && ELEVEN_MODELS.some(m => m.id === patch.voiceModel)) p.voiceModel = patch.voiceModel;
    if ('language' in patch) p.language = String(patch.language || 'fr').slice(0, 8);
    p.updatedAt = now();
    return put('projects', p);
}

export async function setStyleLocked(id, locked) {
    const p = await getProject(id);
    if (!p) throw new DramaError('Projet introuvable');
    if (locked && !p.style.text && !p.style.refImageId) {
        throw new DramaError('Décrivez le style ou ajoutez une image de référence avant de le verrouiller');
    }
    p.style.locked = !!locked;
    p.style.lockedAt = locked ? now() : null;
    p.updatedAt = now();
    return put('projects', p);
}

export async function deleteProject(id) {
    await tx(['projects', 'characters', 'episodes', 'assets'], 'readwrite', s => {
        s.projects.delete(id);
        for (const name of ['characters', 'episodes', 'assets']) {
            const req = s[name].index('projectId').openKeyCursor(IDBKeyRange.only(id));
            req.onsuccess = () => { const c = req.result; if (c) { s[name].delete(c.primaryKey); c.continue(); } };
        }
    });
}

async function touchProject(projectId) {
    const p = await getProject(projectId);
    if (p) { p.updatedAt = now(); await put('projects', p); }
}

// ─── Personnages ──────────────────────────────────────────────────
export async function listCharacters(projectId) {
    const list = await getByProject('characters', projectId);
    return list.sort((a, b) => a.createdAt - b.createdAt);
}

function cleanVoice(v = {}) {
    return {
        voiceId: String(v.voiceId || '').trim().slice(0, 64),
        voiceName: String(v.voiceName || '').trim().slice(0, 80),
        stability: clamp(v.stability, 0, 1, DEFAULT_VOICE.stability),
        similarity: clamp(v.similarity, 0, 1, DEFAULT_VOICE.similarity),
        style: clamp(v.style, 0, 1, DEFAULT_VOICE.style),
        speed: clamp(v.speed, 0.7, 1.2, DEFAULT_VOICE.speed)
    };
}

export async function saveCharacter(projectId, data) {
    const name = String(data.name || '').trim().replace(/^@/, '');
    if (!NAME_REGEX.test(name)) {
        throw new DramaError('Nom en un seul mot, sans espace (lettres, chiffres, - ou _)');
    }
    const others = await listCharacters(projectId);
    const clash = others.find(c => normalizeName(c.name) === normalizeName(name) && c.id !== data.id);
    if (clash) throw new DramaError('Une fiche @' + clash.name + ' existe déjà dans cette série');

    const existing = data.id ? others.find(c => c.id === data.id) : null;
    if (data.id && !existing) throw new DramaError('Personnage introuvable');
    if (existing && existing.refImageId && 'refImageId' in data && data.refImageId !== existing.refImageId) {
        await deleteAsset(existing.refImageId);
    }
    const c = {
        id: existing ? existing.id : newId('c'),
        projectId,
        name,
        desc: String(data.desc ?? (existing && existing.desc) ?? '').trim().slice(0, 1000),
        refImageId: 'refImageId' in data ? data.refImageId : (existing ? existing.refImageId : null),
        voice: cleanVoice({ ...(existing ? existing.voice : DEFAULT_VOICE), ...(data.voice || {}) }),
        createdAt: existing ? existing.createdAt : now(),
        updatedAt: now()
    };
    await put('characters', c);
    await touchProject(projectId);
    return c;
}

export async function deleteCharacter(id) {
    const c = await get('characters', id);
    if (!c) return;
    if (c.refImageId) await deleteAsset(c.refImageId);
    await tx('characters', 'readwrite', s => s.delete(id));
    await touchProject(c.projectId);
}

export async function findCharacterByTag(projectId, tag) {
    const n = normalizeName(String(tag).replace(/^@/, ''));
    return (await listCharacters(projectId)).find(c => normalizeName(c.name) === n) || null;
}

// ─── Épisodes ─────────────────────────────────────────────────────
export async function listEpisodes(projectId) {
    const list = await getByProject('episodes', projectId);
    return list.sort((a, b) => a.number - b.number);
}

export async function createEpisode(projectId, { title = '', script = '' } = {}) {
    const list = await listEpisodes(projectId);
    const number = list.reduce((m, e) => Math.max(m, e.number), 0) + 1;
    const e = {
        id: newId('e'), projectId, number,
        title: String(title).trim().slice(0, 120) || 'Épisode ' + number,
        script: String(script), status: 'brouillon',
        createdAt: now(), updatedAt: now()
    };
    await put('episodes', e);
    await touchProject(projectId);
    return e;
}

export async function updateEpisode(id, patch) {
    const e = await get('episodes', id);
    if (!e) throw new DramaError('Épisode introuvable');
    if ('title' in patch) e.title = String(patch.title || '').trim().slice(0, 120) || 'Épisode ' + e.number;
    if ('script' in patch) e.script = String(patch.script || '');
    if ('number' in patch) {
        const n = Math.floor(Number(patch.number));
        if (!(n >= 1 && n <= 9999)) throw new DramaError('Numéro d\'épisode invalide');
        const clash = (await listEpisodes(e.projectId)).find(x => x.number === n && x.id !== id);
        if (clash) throw new DramaError('L\'épisode ' + n + ' existe déjà');
        e.number = n;
    }
    e.updatedAt = now();
    await put('episodes', e);
    await touchProject(e.projectId);
    return e;
}

export async function deleteEpisode(id) {
    const e = await get('episodes', id);
    if (!e) return;
    await tx('episodes', 'readwrite', s => s.delete(id));
    await touchProject(e.projectId);
}

// ─── Médias (images de référence) ─────────────────────────────────
export const getAsset = id => (id ? get('assets', id) : Promise.resolve(null));
export const deleteAsset = id => (id ? tx('assets', 'readwrite', s => s.delete(id)) : Promise.resolve());

async function decodeImage(blob) {
    if (self.createImageBitmap) {
        try { return await createImageBitmap(blob); } catch (e) { /* repli <img> */ }
    }
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
    } finally { URL.revokeObjectURL(url); }
}

// Redimensionne (côté le plus long ≤ REF_IMAGE_MAX) et stocke en JPEG.
export async function saveImageAsset(projectId, fileOrBlob, kind = 'ref') {
    if (!fileOrBlob || !/^image\//.test(fileOrBlob.type || '')) throw new DramaError('Choisissez une image');
    let img;
    try { img = await decodeImage(fileOrBlob); } catch (e) { throw new DramaError('Image illisible'); }
    const w0 = img.width, h0 = img.height;
    const scale = Math.min(1, REF_IMAGE_MAX / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    if (img.close) img.close();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) throw new DramaError('Conversion de l\'image impossible');
    const asset = { id: newId('a'), projectId, kind, mime: 'image/jpeg', width: w, height: h, blob, createdAt: now() };
    return put('assets', asset);
}

// ─── Sauvegarde / restauration d'un projet (fichier .json) ────────
export const EXPORT_FORMAT = 'drama-project';
export const EXPORT_VERSION = 1;

const blobToDataUri = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
});
async function dataUriToBlob(uri) { return (await fetch(uri)).blob(); }

export async function exportProject(id) {
    const project = await getProject(id);
    if (!project) throw new DramaError('Projet introuvable');
    const [characters, episodes, assets] = await Promise.all([
        listCharacters(id), listEpisodes(id), getByProject('assets', id)
    ]);
    return {
        format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now(),
        project, characters, episodes,
        assets: await Promise.all(assets.map(async a => {
            const { blob, ...meta } = a;
            return { ...meta, dataUri: await blobToDataUri(blob) };
        }))
    };
}

// Importe en copie (nouveaux identifiants) : ne remplace jamais un projet existant.
export async function importProject(data) {
    if (!data || data.format !== EXPORT_FORMAT || !data.project) throw new DramaError('Ce fichier n\'est pas un projet Drama');
    if (data.version > EXPORT_VERSION) throw new DramaError('Projet créé par une version plus récente de l\'appli');
    const pid = newId('p');
    const assetMap = {};
    const assets = [];
    for (const a of data.assets || []) {
        assetMap[a.id] = newId('a');
        const { dataUri, ...meta } = a;
        assets.push({ ...meta, id: assetMap[a.id], projectId: pid, blob: await dataUriToBlob(dataUri) });
    }
    const remap = id => (id && assetMap[id]) || null;
    const project = {
        ...data.project, id: pid, updatedAt: now(),
        name: data.project.name,
        style: { ...data.project.style, refImageId: remap(data.project.style && data.project.style.refImageId) }
    };
    const characters = (data.characters || []).map(c => ({
        ...c, id: newId('c'), projectId: pid, refImageId: remap(c.refImageId), voice: cleanVoice(c.voice)
    }));
    const episodes = (data.episodes || []).map(e => ({ ...e, id: newId('e'), projectId: pid }));
    await tx(['projects', 'characters', 'episodes', 'assets'], 'readwrite', s => {
        s.projects.put(project);
        characters.forEach(c => s.characters.put(c));
        episodes.forEach(e => s.episodes.put(e));
        assets.forEach(a => s.assets.put(a));
    });
    requestPersistentStorage();
    return project;
}
