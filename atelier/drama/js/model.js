// Drama — modèle « projet série »
// Projet : style verrouillé (texte, interdits, image de référence, graine).
// Personnage : @Nom unique dans le projet, description, image de référence, voix ElevenLabs.
// Épisode : numéro, titre, script balisé (analysé à l'étape 2).

import { tx, get, put, getAll, getByIndex, getByProject, newId, requestPersistentStorage } from './db.js';
import { parseScript } from './parser.js';

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

// Modèles d'image Agnes acceptés (voir agnes.js)
export const IMAGE_MODEL_IDS = ['agnes-image-2.1-flash', 'agnes-image-2.5-flash', 'agnes-image-2.0-flash'];

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
    if (patch.imageSettings) {
        const cur = p.imageSettings || {};
        const n = patch.imageSettings;
        p.imageSettings = {
            model: IMAGE_MODEL_IDS.includes(n.model) ? n.model : (cur.model || IMAGE_MODEL_IDS[0]),
            size: ['1K', '2K'].includes(n.size) ? n.size : (cur.size || '2K'),
            refs: ['all', 'characters', 'none'].includes(n.refs) ? n.refs : (cur.refs || 'all')
        };
    }
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
    await tx(['projects', 'characters', 'episodes', 'assets', 'shots', 'takes'], 'readwrite', s => {
        s.projects.delete(id);
        for (const name of ['characters', 'episodes', 'assets', 'shots', 'takes']) {
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

// data.id : modifie une fiche existante (les champs absents sont conservés).
export async function saveCharacter(projectId, data) {
    const others = await listCharacters(projectId);
    const existing = data.id ? others.find(c => c.id === data.id) : null;
    if (data.id && !existing) throw new DramaError('Personnage introuvable');
    const name = String(data.name ?? (existing ? existing.name : '')).trim().replace(/^@/, '');
    if (!NAME_REGEX.test(name)) {
        throw new DramaError('Nom en un seul mot, sans espace (lettres, chiffres, - ou _)');
    }
    const clash = others.find(c => normalizeName(c.name) === normalizeName(name) && c.id !== data.id);
    if (clash) throw new DramaError('Une fiche @' + clash.name + ' existe déjà dans cette série');

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

// Enregistre le script et son analyse (liste de plans JSON utilisée par les étapes suivantes).
const statusOf = (script, analysis) => !String(script).trim() ? 'brouillon' : analysis.ok ? 'prêt' : 'à corriger';

export async function saveEpisodeScript(id, script) {
    const e = await get('episodes', id);
    if (!e) throw new DramaError('Épisode introuvable');
    e.script = String(script || '');
    e.analysis = parseScript(e.script, await listCharacters(e.projectId));
    e.status = statusOf(e.script, e.analysis);
    e.updatedAt = now();
    await put('episodes', e);
    await touchProject(e.projectId);
    return e;
}

// Ré-analyse si les fiches personnages ont changé depuis (renommage, suppression, vitesse de voix).
export async function refreshEpisodeAnalyses(projectId) {
    const [eps, chars] = await Promise.all([listEpisodes(projectId), listCharacters(projectId)]);
    const out = [];
    for (const e of eps) {
        const analysis = parseScript(e.script, chars);
        if (!e.analysis || e.analysis.hash !== analysis.hash || e.analysis.version !== analysis.version) {
            e.analysis = analysis;
            e.status = statusOf(e.script, analysis);
            await put('episodes', e);
        }
        out.push(e);
    }
    return out;
}

export async function deleteEpisode(id) {
    const e = await get('episodes', id);
    if (!e) return;
    const [shots, takes] = await Promise.all([getByIndex('shots', 'episodeId', id), getByIndex('takes', 'episodeId', id)]);
    await tx(['episodes', 'shots', 'takes'], 'readwrite', s => {
        s.episodes.delete(id);
        shots.forEach(sh => s.shots.delete(sh.id));
        takes.forEach(t => s.takes.delete(t.id));
    });
    await gcShotAssets(e.projectId);
    await touchProject(e.projectId);
}

// Supprime les images de plans et les prises de voix qui ne sont plus retenues
// par aucun plan ni aucune réplique (versions comprises).
export async function gcShotAssets(projectId) {
    const [assets, shots, takes] = await Promise.all([
        getByProject('assets', projectId), getByProject('shots', projectId), getByProject('takes', projectId)
    ]);
    const used = new Set([...shots, ...takes].flatMap(x => x.versions || []));
    const orphans = assets.filter(a => (a.kind === 'shot' || a.kind === 'voice') && !used.has(a.id));
    if (orphans.length) await tx('assets', 'readwrite', s => orphans.forEach(a => s.delete(a.id)));
    return orphans.length;
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

// includeImages : avec l'image retenue pour chaque plan et la prise retenue pour chaque
// réplique (sans les anciennes versions, pour garder un fichier raisonnable sur téléphone).
export async function exportProject(id, { includeImages = true } = {}) {
    const project = await getProject(id);
    if (!project) throw new DramaError('Projet introuvable');
    const [characters, episodes, allAssets, allShots, allTakes] = await Promise.all([
        listCharacters(id), listEpisodes(id), getByProject('assets', id), getByProject('shots', id), getByProject('takes', id)
    ]);
    const onlyCurrent = list => includeImages ? list.filter(x => x.current).map(x => ({ ...x, versions: [x.current] })) : [];
    const shots = onlyCurrent(allShots);
    const takes = onlyCurrent(allTakes);
    const kept = new Set([...shots, ...takes].map(x => x.current));
    const assets = allAssets.filter(a => (a.kind !== 'shot' && a.kind !== 'voice') || kept.has(a.id));
    return {
        format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now(),
        project, characters, episodes, shots, takes,
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
        // key : identité stable de l'image (sert au cache des images de plans après import)
        assets.push({ ...meta, key: meta.key || a.id, id: assetMap[a.id], projectId: pid, blob: await dataUriToBlob(dataUri) });
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
    const episodeMap = {};
    const episodes = (data.episodes || []).map(e => {
        episodeMap[e.id] = newId('e');
        return { ...e, id: episodeMap[e.id], projectId: pid };
    });
    assets.forEach(a => { if (a.episodeId) a.episodeId = episodeMap[a.episodeId] || null; });
    const remapMedia = (list, idOf) => (list || []).filter(x => episodeMap[x.episodeId]).map(x => {
        const versions = (x.versions || []).map(remap).filter(Boolean);
        const eid = episodeMap[x.episodeId];
        return { ...x, id: idOf(eid, x), projectId: pid, episodeId: eid,
            versions, current: remap(x.current) || versions[versions.length - 1] || null };
    }).filter(x => x.current);
    const shots = remapMedia(data.shots, (eid, sh) => eid + ':' + sh.planId);
    const takes = remapMedia(data.takes, (eid, t) => eid + ':' + t.lineId);
    await tx(['projects', 'characters', 'episodes', 'assets', 'shots', 'takes'], 'readwrite', s => {
        s.projects.put(project);
        characters.forEach(c => s.characters.put(c));
        episodes.forEach(e => s.episodes.put(e));
        assets.forEach(a => s.assets.put(a));
        shots.forEach(sh => s.shots.put(sh));
        takes.forEach(t => s.takes.put(t));
    });
    requestPersistentStorage();
    return project;
}
