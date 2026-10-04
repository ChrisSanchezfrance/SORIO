// Drama — onglet « 🎬 Drama » de l'appli Atelier Vidéo.
// Même présentation que l'onglet Vidéos : un panneau en haut (série en cours, clés),
// puis des sections repliables : Style, Personnages, Épisodes, Script, Images, Voix, Animation, Montage, Export, Rendu en lot, Sauvegarde.
import * as M from './model.js';
import * as EL from './elevenlabs.js';
import * as IMG from './images.js';
import * as VO from './voices.js';
import * as PL from './player.js';
import * as EX from './export.js';
import * as BT from './batch.js';
import * as MIC from './mic.js';
import * as CL from './clips.js';
import { requiredSounds, SUB_SIZES } from './montage.js';
import { parseScript } from './parser.js';
import { IMAGE_MODELS, IMAGE_SIZES, getAgnesKey } from './agnes.js';

const root = document.getElementById('drama-root');
const CUR_PROJECT = 'drama_current_project';
const CUR_EPISODE = 'drama_current_episode:';
const OPEN_KEY = 'drama_open_sections';

const SECTIONS = [
    ['style', '🎨 Style de la série'],
    ['chars', '🎭 Personnages de la série'],
    ['episodes', '📺 Épisodes'],
    ['script', '📝 Script'],
    ['images', '🖼️ Images des plans'],
    ['voices', '🎙️ Voix et durées'],
    ['clips', '🎬 Animation des plans (Agnes)'],
    ['montage', '🎞️ Montage'],
    ['export', '📤 Export'],
    ['batch', '🗂️ Rendu en lot'],
    ['backup', '💾 Sauvegarde et gestion']
];

const S = {
    pid: null, eid: null,
    newSeries: false, elevenForm: false,
    voices: null, previewAudio: null,
    editingCharId: null, charImageId: undefined, charDraft: null,
    scriptTimer: null, pendingScript: null, lastAnalysis: null,
    imagesTimer: null,
    job: null,           // génération d'images en cours : { pid, eid, ctrl, states: Map, line, running }
    vjob: null,          // génération des voix en cours (même forme)
    cjob: null,          // animation des plans par Agnes en cours (même forme)
    player: null,        // écoute de l'épisode : { ctx, timer }
    preview: null,       // aperçu du montage (player.js)
    montageTl: null,     // timeline de l'épisode affiché dans le Montage
    xjob: null,          // export en cours : { eid, ctrl, running, phase, done, total, started }
    codecs: null,        // codecs d'export disponibles sur cet appareil
    exportUrl: null,     // { name, url } de l'aperçu du MP4 exporté
    bjob: null,          // rendu en lot en cours : { ctrl, running, eid, phase, done, total }
    batchSel: null,      // épisodes cochés pour le lot (Set)
    rec: null            // enregistrement au micro en cours : { lineId, eid, session, timer }
};

// ─── Utilitaires ──────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = t => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function fmtDuration(sec) {
    const s = Math.round(sec);
    return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0');
}
const $ = sel => root.querySelector(sel);
const plural = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

function toast(msg, type = 'success', ms = 2500) {
    if (typeof window.showToast === 'function') window.showToast(msg, type, ms);
}
const fail = e => { console.error(e); toast(e && e.message ? e.message : String(e), 'error', 3800); };

// URL d'aperçu des images (réutilisées d'un affichage à l'autre)
const assetUrls = new Map();
async function assetUrl(id) {
    if (!id) return '';
    if (assetUrls.has(id)) return assetUrls.get(id);
    const a = await M.getAsset(id);
    if (!a) return '';
    const u = URL.createObjectURL(a.blob);
    assetUrls.set(id, u);
    return u;
}
function pruneAssetUrls() {
    const used = new Set([...root.querySelectorAll('img[data-asset], video[data-asset]')].map(i => i.dataset.asset));
    for (const [id, u] of assetUrls) if (!used.has(id)) { URL.revokeObjectURL(u); assetUrls.delete(id); }
}

function pickFile(accept) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        document.body.appendChild(input);
        let settled = false;
        const finish = f => { if (settled) return; settled = true; input.remove(); resolve(f); };
        input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null), { once: true });
        input.addEventListener('cancel', () => finish(null), { once: true });
        if (!('oncancel' in input)) {
            // navigateur sans événement « cancel » : sélecteur refermé sans fichier
            window.addEventListener('focus', () => setTimeout(() => finish(null), 3000), { once: true });
        }
        input.click();
    });
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// Sections ouvertes / fermées (mémorisé)
function openState() { try { return JSON.parse(lsGet(OPEN_KEY) || '{}'); } catch (e) { return {}; } }
function isOpen(k, ctx) {
    const st = openState();
    if (k in st) return !!st[k];
    if (k === 'style') return !ctx.project.style.locked;
    if (k === 'chars') return ctx.chars.length === 0;
    return k === 'episodes' || k === 'script' || k === 'images' || k === 'voices' || k === 'clips' || k === 'montage' || k === 'export';
}
function setOpen(k, v) { const st = openState(); st[k] = v; lsSet(OPEN_KEY, JSON.stringify(st)); }
function openSection(k) {
    const sec = $('#d-sec-' + k);
    if (sec && !sec.classList.contains('open')) { sec.classList.add('open'); setOpen(k, true); }
}

// ─── Données de l'écran ───────────────────────────────────────────
async function loadCtx() {
    const projects = await M.listProjects();
    if (!S.pid || !projects.some(p => p.id === S.pid)) {
        const saved = lsGet(CUR_PROJECT);
        S.pid = projects.some(p => p.id === saved) ? saved : (projects[0] ? projects[0].id : null);
    }
    lsSet(CUR_PROJECT, S.pid || '');
    if (!S.pid) return { projects, project: null, chars: [], episodes: [], episode: null };
    const [project, chars, episodes] = await Promise.all([
        M.getProject(S.pid), M.listCharacters(S.pid), M.refreshEpisodeAnalyses(S.pid)
    ]);
    if (!S.eid || !episodes.some(e => e.id === S.eid)) {
        const saved = lsGet(CUR_EPISODE + S.pid);
        S.eid = episodes.some(e => e.id === saved) ? saved : (episodes[0] ? episodes[0].id : null);
    }
    lsSet(CUR_EPISODE + S.pid, S.eid || '');
    const episode = episodes.find(e => e.id === S.eid) || null;
    S.lastEpisodes = episodes;
    return { projects, project, chars, episodes, episode };
}

// ─── Panneau du haut : série en cours + clés ──────────────────────
function buildTop(ctx) {
    const showNew = S.newSeries || !ctx.projects.length;
    const options = ctx.projects.map(p => '<option value="' + p.id + '"' + (p.id === S.pid ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
    const agnes = getAgnesKey();
    const eleven = EL.getKey();
    return '<div class="api-panel' + (ctx.project ? ' ok' : '') + '" id="d-top">' +
        (ctx.projects.length
            ? '<label class="control-label" for="d-series">🎬 Série en cours</label>' +
              '<select id="d-series">' + options + '<option value="__new">＋ Nouvelle série…</option><option value="__import">⤓ Importer une sauvegarde…</option></select>'
            : '<div class="d-intro"><strong>Drama</strong> : vos séries en images animées et doublées (9:16). Commencez par créer une série.</div>') +
        '<div class="d-new' + (showNew ? '' : ' hidden') + '" id="d-new">' +
            '<div class="control-row"><label class="control-label" for="d-new-name">Titre de la nouvelle série</label>' +
                '<input type="text" class="char-input" id="d-new-name" maxlength="80" placeholder="Ex. : Néons Brisés"></div>' +
            '<div class="control-row"><label class="control-label" for="d-new-style">Style visuel (facultatif)</label>' +
                '<textarea id="d-new-style" placeholder="Ex. : manhwa dramatique, couleurs froides, lumière néon, traits fins"></textarea></div>' +
            '<button type="button" class="api-save-btn" data-action="create-project">Créer la série</button>' +
            '<div class="char-actions">' +
                (ctx.projects.length ? '<button type="button" class="char-btn" data-action="cancel-new">Annuler</button>' : '') +
                '<button type="button" class="char-btn" data-action="import-project">Importer une sauvegarde</button>' +
            '</div>' +
        '</div>' +
        '<div class="wake-status ' + (agnes ? 'active' : 'warn') + '" id="d-agnes">' +
            '<span>' + (agnes ? '🖼️ Images Agnes : clé active (celle de l\'onglet Vidéos)' : '⚠️ Images Agnes : ajoutez votre clé dans l\'onglet Vidéos') + '</span>' +
            (agnes ? '' : '<button type="button" data-action="goto-videos">Onglet Vidéos</button>') +
        '</div>' +
        '<div class="wake-status ' + (eleven ? 'active' : 'app-status') + '" id="d-eleven">' +
            '<span>' + (eleven ? '🎙️ Voix ElevenLabs : clé active' : '🎙️ Voix ElevenLabs : aucune clé (servira pour le doublage)') + '</span>' +
            '<button type="button" data-action="eleven-edit">' + (eleven ? 'Modifier' : 'Ajouter') + '</button>' +
        '</div>' +
        '<div class="d-eleven-form' + (S.elevenForm ? '' : ' hidden') + '">' +
            '<input type="password" class="api-key-input" id="d-eleven-key" autocomplete="off" spellcheck="false" placeholder="Collez votre clé ElevenLabs" value="' + esc(eleven) + '">' +
            '<div class="char-actions"><button type="button" class="char-btn" data-action="save-eleven">Enregistrer la clé</button>' +
            '<button type="button" class="char-btn" data-action="test-eleven"' + (eleven ? '' : ' disabled') + '>Vérifier</button></div>' +
            '<div class="api-hint" id="d-eleven-status">elevenlabs.io → Profile → API Keys. La clé reste sur ce téléphone.</div>' +
        '</div>' +
    '</div>';
}

// ─── Section Style ────────────────────────────────────────────────
async function buildStyle(ctx) {
    const p = ctx.project;
    const locked = p.style.locked;
    const dis = locked ? ' disabled' : '';
    const ref = await assetUrl(p.style.refImageId);
    return {
        badge: locked ? '🔒 verrouillé' : 'modifiable', badgeClass: locked ? 'ok' : 'soft',
        html:
            '<div class="lock-banner' + (locked ? ' locked' : '') + '"><span>' +
                (locked ? '🔒 Verrouillé le ' + fmtDate(p.style.lockedAt) + ' : toutes les images de la série suivent ce style.'
                        : '🔓 Réglez le style, puis verrouillez-le avant de générer les images.') + '</span>' +
                '<button type="button" class="char-btn" data-action="toggle-lock">' + (locked ? 'Déverrouiller' : 'Verrouiller le style') + '</button></div>' +
            '<div class="control-row"><label class="control-label" for="d-style-text">Description du style</label>' +
                '<textarea id="d-style-text"' + dis + ' placeholder="Ex. : manhwa dramatique, couleurs froides, lumière néon, traits fins">' + esc(p.style.text) + '</textarea></div>' +
            '<div class="control-row"><label class="control-label" for="d-style-neg">À éviter dans les images</label>' +
                '<input type="text" class="char-input" id="d-style-neg"' + dis + ' value="' + esc(p.style.negative) + '" placeholder="Ex. : 3D, photo réaliste, couleurs chaudes"></div>' +
            '<div class="control-row"><label class="control-label">Image de référence du style</label><div class="char-photo-row">' +
                (ref ? '<img class="d-ref" src="' + ref + '" data-asset="' + p.style.refImageId + '" alt="Référence du style">' : '<div class="d-ref"></div>') +
                '<button type="button" class="char-btn" data-action="pick-style-image"' + dis + '>' + (ref ? 'Changer' : 'Choisir une image') + '</button>' +
                (ref ? '<button type="button" class="char-btn danger" data-action="remove-style-image"' + dis + '>Retirer</button>' : '') +
            '</div></div>' +
            (locked ? '' : '<button type="button" class="api-save-btn" data-action="save-style">Enregistrer le style</button>')
    };
}

// ─── Section Personnages ──────────────────────────────────────────
async function buildChars(ctx) {
    const cards = await Promise.all(ctx.chars.map(async c => {
        const t = await assetUrl(c.refImageId);
        return '<div class="char-card">' +
            (t ? '<img class="char-thumb" src="' + t + '" data-asset="' + c.refImageId + '" alt="">' : '<div class="char-thumb">' + esc(c.name[0].toUpperCase()) + '</div>') +
            '<div class="char-info"><div class="char-tag">@' + esc(c.name) + '</div>' +
                '<div class="char-desc">' + (c.desc ? esc(c.desc) : '<em>Sans description</em>') + '</div>' +
                '<div class="char-desc">🎙️ ' + (c.voice.voiceId ? esc(c.voice.voiceName || c.voice.voiceId) : '<em>voix à choisir</em>') + '</div>' +
                '<div class="char-actions">' +
                    '<button type="button" class="char-btn" data-action="edit-char" data-id="' + c.id + '">Modifier</button>' +
                    '<button type="button" class="char-btn danger" data-action="delete-char" data-id="' + c.id + '">Supprimer</button>' +
                '</div></div></div>';
    }));
    const editing = S.editingCharId ? ctx.chars.find(c => c.id === S.editingCharId) : null;
    if (S.editingCharId && !editing) S.editingCharId = null;
    return {
        badge: ctx.chars.length ? String(ctx.chars.length) : 'à créer', badgeClass: '',
        html:
            '<p class="char-intro">Une fiche par personnage : @Nom dans le script, apparence fixe, photo de référence (même visage dans toutes les images) et voix.</p>' +
            '<div class="char-list">' + (cards.length ? cards.join('') : '<div class="char-empty">Aucun personnage pour l\'instant.</div>') + '</div>' +
            '<div class="control-row"><label class="control-label" for="d-voice-model">Modèle de voix ElevenLabs (toute la série)</label>' +
                '<select id="d-voice-model">' + M.ELEVEN_MODELS.map(m => '<option value="' + m.id + '"' + (m.id === ctx.project.voiceModel ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></div>' +
            '<div class="char-form" id="d-char-form">' + await buildCharForm(editing) + '</div>'
    };
}

async function buildCharForm(c) {
    const d = S.charDraft || {};
    const v = { ...M.DEFAULT_VOICE, ...(c ? c.voice : {}), ...(d.voice || {}) };
    const name = d.name ?? (c ? c.name : '');
    const desc = d.desc ?? (c ? c.desc : '');
    const imgId = S.charImageId !== undefined ? S.charImageId : (c ? c.refImageId : null);
    const img = await assetUrl(imgId);
    const voiceSelect = S.voices
        ? '<select id="d-char-voice-select"><option value="">— Choisir une voix —</option>' +
          S.voices.map(x => '<option value="' + esc(x.voiceId) + '"' + (x.voiceId === v.voiceId ? ' selected' : '') + '>' +
              esc(x.name) + (EL.describeVoice(x) ? ' — ' + esc(EL.describeVoice(x)) : '') + '</option>').join('') + '</select>'
        : '';
    const slider = (id, label, min, max, step, val) =>
        '<div><div class="d-slider"><span>' + label + '</span><span id="' + id + '-val">' + val + '</span></div>' +
        '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"></div>';
    return '<div class="control-label" style="margin-bottom:0.6rem">' + (c ? 'Modifier @' + esc(c.name) : 'Nouveau personnage') + '</div>' +
        '<div class="control-row"><label class="control-label" for="d-char-name">Nom (un seul mot, appelé avec @Nom)</label>' +
            '<input type="text" class="char-input" id="d-char-name" maxlength="30" autocomplete="off" spellcheck="false" placeholder="Lina" value="' + esc(name) + '"></div>' +
        '<div class="control-row"><label class="control-label" for="d-char-desc">Description fixe (apparence)</label>' +
            '<textarea id="d-char-desc" placeholder="Femme de 28 ans, cheveux noirs au carré, yeux verts, trench beige">' + esc(desc) + '</textarea></div>' +
        '<div class="control-row"><label class="control-label">Photo de référence</label><div class="char-photo-row">' +
            (img ? '<img class="char-photo-preview" src="' + img + '" data-asset="' + imgId + '" alt="">' : '') +
            '<button type="button" class="char-btn" data-action="pick-char-image">' + (img ? 'Changer la photo' : 'Choisir une photo') + '</button>' +
            (img ? '<button type="button" class="char-btn danger" data-action="remove-char-image">Retirer la photo</button>' : '') +
        '</div></div>' +
        '<div class="control-row"><label class="control-label">Voix</label>' + voiceSelect +
            '<input type="text" class="char-input' + (S.voices ? ' hidden' : '') + '" id="d-char-voice-id" placeholder="Identifiant de voix ElevenLabs" autocomplete="off" spellcheck="false" value="' + esc(v.voiceId) + '">' +
            '<input type="hidden" id="d-char-voice-name" value="' + esc(v.voiceName) + '">' +
            '<div class="char-actions">' +
                '<button type="button" class="char-btn" data-action="load-voices">' + (S.voices ? '↻ Recharger mes voix' : 'Charger mes voix ElevenLabs') + '</button>' +
                '<button type="button" class="char-btn" data-action="preview-voice">▶ Écouter l\'extrait</button>' +
            '</div></div>' +
        '<div class="control-row d-grid2">' +
            slider('d-v-stability', 'Stabilité', 0, 1, 0.05, v.stability) +
            slider('d-v-similarity', 'Fidélité', 0, 1, 0.05, v.similarity) +
            slider('d-v-style', 'Expressivité', 0, 1, 0.05, v.style) +
            slider('d-v-speed', 'Vitesse', 0.7, 1.2, 0.05, v.speed) +
        '</div>' +
        '<button type="button" class="api-save-btn" data-action="save-char">' + (c ? 'Mettre à jour @' + esc(c.name) : 'Enregistrer le personnage') + '</button>' +
        (c ? '<button type="button" class="char-btn" data-action="cancel-char">Annuler la modification</button>' : '');
}

function readCharForm() {
    const sel = $('#d-char-voice-select');
    let voiceId = $('#d-char-voice-id').value.trim();
    let voiceName = $('#d-char-voice-name').value;
    if (sel) {
        voiceId = sel.value;
        const found = S.voices.find(x => x.voiceId === voiceId);
        voiceName = found ? found.name : '';
    }
    return {
        name: $('#d-char-name').value,
        desc: $('#d-char-desc').value,
        voice: {
            voiceId, voiceName,
            stability: $('#d-v-stability').value, similarity: $('#d-v-similarity').value,
            style: $('#d-v-style').value, speed: $('#d-v-speed').value
        }
    };
}

async function discardCharImage() {
    if (S.charImageId && S.pid) {
        const chars = await M.listCharacters(S.pid);
        if (!chars.some(c => c.refImageId === S.charImageId)) await M.deleteAsset(S.charImageId);
    }
    S.charImageId = undefined;
}
function resetCharForm() { S.editingCharId = null; S.charDraft = null; }

// ─── Section Épisodes ─────────────────────────────────────────────
async function buildEpisodes(ctx) {
    const cards = await Promise.all(ctx.episodes.map(async e => {
        const a = e.analysis;
        const n = a ? a.stats.plans : 0;
        const state = !a || !e.script.trim() ? '📝 brouillon'
            : a.ok ? '✅ prêt · ~' + fmtDuration(a.stats.estimatedSeconds)
            : '❌ ' + plural(a.errors.length, 'erreur');
        const imgs = a && a.ok ? await IMG.readyCount(ctx.project, ctx.chars, e) : null;
        const vox = a && a.ok ? await VO.voiceReadyCount(ctx.project, ctx.chars, e) : null;
        return '<div class="d-ep' + (e.id === S.eid ? ' current' : '') + '" data-action="select-episode" data-eid="' + e.id + '">' +
            '<div class="d-ep-num">EP.' + e.number + '</div>' +
            '<div class="d-ep-main"><div class="d-ep-title">' + esc(e.title) + '</div>' +
            '<div class="d-ep-sub">' + plural(n, 'plan') + ' · ' + state + (imgs ? ' · 🖼️ ' + imgs.ready + '/' + imgs.total : '') + (vox && vox.total ? ' · 🎙️ ' + vox.ready + '/' + vox.total : '') + (e.exportInfo ? ' · 📤 MP4' : '') + '</div></div>' +
            (e.id === S.eid ? '<div class="d-ep-check">✓</div>' : '') + '</div>';
    }));
    return {
        badge: ctx.episodes.length ? String(ctx.episodes.length) : 'à créer', badgeClass: '',
        html: (cards.length ? cards.join('') : '<div class="char-empty">Aucun épisode.</div>') +
            '<button type="button" class="api-save-btn" data-action="new-episode">＋ Nouvel épisode</button>'
    };
}

// ─── Section Script ───────────────────────────────────────────────
const PLAN_TEMPLATE =
`[PLAN] 1
[DECOR] Lieu, moment, ambiance
[PERSOS] @Nom
[IMAGE] Ce que l'on voit dans l'image
[CAM] zoom-in lent ; transition: fondu
[VOIX] @Nom: « Réplique. »
[SFX] nom-du-son @0.5s
[MUSIQUE] tension
`;
const SYNTAX_HELP =
    '<div class="d-help">' +
    '<b>[PLAN]</b> 12 — numéro facultatif<br>' +
    '<b>[DECOR]</b> lieu, moment (repris du plan précédent si absent)<br>' +
    '<b>[PERSOS]</b> @Lina @Marc<br>' +
    '<b>[IMAGE]</b> ce que l\'on voit (obligatoire, peut continuer à la ligne)<br>' +
    '<b>[CAM]</b> fixe, zoom-in, zoom-out, pan-gauche/droite/haut/bas, tremblement + lent, rapide, léger, fort ; ' +
    'combinables avec « + » ; <code>transition: fondu | fondu au noir | fondu au blanc | glisse-gauche | glisse-droite | flash | coupe</code> ; ' +
    '<code>duree: 4s</code><br>' +
    '<b>[VOIX]</b> @Lina (chuchoté): « réplique » — plusieurs lignes possibles<br>' +
    '<b>[SFX]</b> porte-claque @1.2s vol: 0.6<br>' +
    '<b>[MUSIQUE]</b> tension vol: 0.5 | continue | stop<br>' +
    'Plan sans réplique : 2,5 s par défaut. # ou // : commentaire.</div>';

function scriptBadge(e) {
    if (!e) return { badge: '—', badgeClass: '' };
    const a = e.analysis;
    if (!a || !e.script.trim()) return { badge: 'EP.' + e.number + ' · vide', badgeClass: '' };
    return a.ok ? { badge: 'EP.' + e.number + ' · ' + plural(a.stats.plans, 'plan'), badgeClass: 'ok' }
        : { badge: 'EP.' + e.number + ' · ' + plural(a.errors.length, 'erreur'), badgeClass: 'bad' };
}

async function buildScript(ctx) {
    const e = ctx.episode;
    if (!e) return { badge: '—', badgeClass: '', html: '<div class="char-empty">Créez un épisode dans « 📺 Épisodes ».</div>' };
    return {
        ...scriptBadge(e),
        html:
            '<div class="d-grid2" style="grid-template-columns:5rem 1fr">' +
                '<div class="control-row"><label class="control-label" for="d-ep-number">EP.</label><input type="number" class="char-input" id="d-ep-number" min="1" max="9999" value="' + e.number + '"></div>' +
                '<div class="control-row"><label class="control-label" for="d-ep-title">Titre</label><input type="text" class="char-input" id="d-ep-title" maxlength="120" value="' + esc(e.title) + '"></div>' +
            '</div>' +
            '<div class="prompt-presets" style="margin:0 0 0.5rem">' +
                ctx.chars.map(c => '<div class="prompt-preset" data-action="insert-tag" data-tag="@' + esc(c.name) + '">@' + esc(c.name) + '</div>').join('') +
                '<div class="prompt-preset" data-action="insert-template">＋ Modèle de plan</div>' +
            '</div>' +
            '<textarea class="d-script" id="d-script" spellcheck="false" placeholder="' + esc(PLAN_TEMPLATE) + '">' + esc(e.script) + '</textarea>' +
            '<div class="d-save-state" id="d-save-state">Enregistré</div>' +
            '<details class="d-help-box"><summary>Aide sur les balises</summary>' + SYNTAX_HELP + '</details>' +
            '<div id="d-analysis" class="d-analysis"></div>' +
            '<button type="button" class="btn-stop visible" data-action="delete-episode">Supprimer cet épisode</button>'
    };
}

const MOVE_LABELS = { 'fixe': 'fixe', 'zoom-in': 'zoom avant', 'zoom-out': 'zoom arrière', 'pan-gauche': 'pan ←', 'pan-droite': 'pan →',
    'pan-haut': 'pan ↑', 'pan-bas': 'pan ↓', 'tremblement': 'tremblement' };
const TRANS_LABELS = { 'coupe': 'coupe', 'fondu': 'fondu', 'fondu-noir': 'fondu au noir', 'fondu-blanc': 'fondu au blanc',
    'glisse-gauche': 'glisse ←', 'glisse-droite': 'glisse →', 'flash': 'flash' };

function renderAnalysis(a) {
    S.lastAnalysis = a;
    const box = $('#d-analysis');
    if (!box || !a) return;
    const st = a.stats;
    const inTarget = st.estimatedSeconds >= st.target.min && st.estimatedSeconds <= st.target.max;
    const head = a.errors.length
        ? '<div class="an-head bad">❌ ' + plural(a.errors.length, 'erreur') + ' à corriger</div>'
        : st.plans ? '<div class="an-head ok">✅ ' + plural(st.plans, 'plan') + ' prêt' + (st.plans > 1 ? 's' : '') + '</div>'
                   : '<div class="an-head">Script vide</div>';
    const issues = a.errors.concat(a.warnings).sort((x, y) => x.line - y.line).map(i =>
        '<button type="button" class="issue ' + i.severity + '" data-action="goto-line" data-line="' + i.line + '">' +
        '<span class="issue-line">L.' + i.line + '</span>' + (i.severity === 'error' ? '❌ ' : '⚠️ ') + esc(i.message) + '</button>').join('');
    const plans = a.plans.map(p => {
        const cam = p.cam.moves.map(m => MOVE_LABELS[m.type] + (m.speed !== 'normal' ? ' ' + m.speed : '') +
            (m.intensity !== 'normal' ? ' ' + (m.intensity === 'leger' ? 'léger' : m.intensity) : '')).join(' + ');
        const dur = p.duration.mode === 'audio' ? '~' + p.duration.estimate + ' s (voix)'
            : p.duration.seconds + ' s' + (p.duration.mode === 'fixed' ? ' (imposée)' : ' (défaut)');
        const music = p.musique.action === 'start' ? '🎵 ' + esc(p.musique.label || p.musique.track) + ' ▶'
            : p.musique.action === 'stop' ? '🎵 stop' : '';
        return '<div class="plan-card" data-action="goto-line" data-line="' + p.line + '">' +
            '<div class="plan-top"><b>' + p.id + '</b>' + (p.title ? ' · ' + esc(p.title) : '') + '<span class="plan-dur">⏱ ' + dur + '</span></div>' +
            '<div class="plan-meta">📍 ' + (p.decor ? esc(p.decor) + (p.decorInherited ? ' <i>(repris)</i>' : '') : '<i>sans décor</i>') +
                (p.persos.length ? ' · 👤 ' + p.persos.map(n => '@' + esc(n)).join(' ') : '') + '</div>' +
            '<div class="plan-img">🖼️ ' + esc(p.image || '—') + '</div>' +
            '<div class="plan-meta">🎥 ' + cam + (p.cam.transition.type !== 'coupe' ? ' · ↪ ' + TRANS_LABELS[p.cam.transition.type] + ' ' + p.cam.transition.duration + ' s' : '') +
                (music ? ' · ' + music : '') + '</div>' +
            p.voix.map(v => '<div class="plan-voice">🗣️ <b>@' + esc(v.perso) + '</b>' + (v.ton ? ' <i>(' + esc(v.ton) + ')</i>' : '') +
                (v.horsChamp ? ' <i>hors champ</i>' : '') + ' : « ' + esc(v.texte) + ' »</div>').join('') +
            p.sfx.map(x => '<div class="plan-meta">🔊 ' + esc(x.label || x.name) + ' à ' + x.at + ' s' + (x.volume !== 1 ? ' · vol ' + x.volume : '') + '</div>').join('') +
        '</div>';
    }).join('');
    box.innerHTML =
        '<div class="control-label" style="margin:0.9rem 0 0.5rem">🧩 Plans (analyse du script)</div>' + head +
        (st.plans ? '<div class="an-stats">' + plural(st.voix, 'réplique') + ' · ' + plural(st.sfx, 'son') + ' · ' + plural(st.characters.length, 'personnage') +
            ' · durée estimée ~' + fmtDuration(st.estimatedSeconds) +
            ' <span class="' + (inTarget ? 'ok' : 'off') + '">(objectif 3–6 min' + (inTarget ? ' ✓' : '') + ')</span>' +
            (st.tracks.length ? '<br>Musiques à importer : ' + st.tracks.map(esc).join(', ') : '') + '</div>' : '') +
        (issues ? '<div class="issues">' + issues + '</div>' : '') + plans +
        (st.plans ? '<details class="json-box"><summary>JSON des plans</summary>' +
            '<div class="char-actions"><button type="button" class="char-btn" data-action="copy-json">Copier</button>' +
            '<button type="button" class="char-btn" data-action="download-json">Télécharger</button></div>' +
            '<pre class="json">' + esc(JSON.stringify(a.plans, null, 2)) + '</pre></details>' : '');
}

function gotoLine(line) {
    const ta = $('#d-script');
    if (!ta) return;
    const lines = ta.value.split('\n');
    const n = Math.max(1, Math.min(line, lines.length));
    const start = lines.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, start + lines[n - 1].length);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, (n - 3) * lh);
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function scheduleScriptSave() {
    const ta = $('#d-script');
    if (!ta) return;
    const st = $('#d-save-state');
    if (st) st.textContent = 'Modification…';
    S.pendingScript = { eid: S.eid, script: ta.value };
    clearTimeout(S.scriptTimer);
    S.scriptTimer = setTimeout(flushScript, 500);
}
async function flushScript() {
    clearTimeout(S.scriptTimer);
    const job = S.pendingScript;
    S.pendingScript = null;
    if (!job) return;
    try {
        const e = await M.saveEpisodeScript(job.eid, job.script);
        if (S.eid !== job.eid) return;
        const st = $('#d-save-state');
        if (st) st.textContent = 'Enregistré ✓';
        renderAnalysis(e.analysis);
        setBadge('script', scriptBadge(e));
        if (!(S.job && S.job.running)) {
            clearTimeout(S.imagesTimer);
            S.imagesTimer = setTimeout(() => refresh('episodes', 'images', 'voices').catch(fail), 900);
        }
    } catch (e) { fail(e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushScript(); });
window.addEventListener('pagehide', flushScript);

function insertAtCursor(ta, text) {
    const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(en);
    ta.focus();
    ta.setSelectionRange(s + text.length, s + text.length);
    scheduleScriptSave();
}

// ─── Section Images ───────────────────────────────────────────────
const STATE_CHIPS = {
    ok: ['ok', '✅ à jour'], cached: ['soft', '♻️ en cache'], stale: ['warn', '♻️ à refaire (script ou style modifié)'],
    missing: ['', '○ à générer'], queued: ['', '⏳ en attente'], running: ['run', '🎨 création…'],
    waiting: ['warn', '⏸ nouvel essai'], error: ['bad', '❌ échec'], stopped: ['', '⏹ arrêté']
};

async function buildImages(ctx) {
    const e = ctx.episode;
    if (!e) return { badge: '—', badgeClass: '', html: '<div class="char-empty">Créez un épisode dans « 📺 Épisodes ».</div>' };
    const a = e.analysis;
    if (!a || !a.plans.length) return { badge: 'EP.' + e.number, badgeClass: '', html: '<div class="char-empty">Écrivez le script de l\'épisode : chaque [PLAN] aura son image.</div>' };

    const settings = { ...IMG.DEFAULT_IMAGE_SETTINGS, ...(ctx.project.imageSettings || {}) };
    const job = S.job && S.job.eid === e.id ? S.job : null;
    const running = !!(S.job && S.job.running);
    const dis = running ? ' disabled' : '';
    const states = await IMG.planStates(ctx.project, ctx.chars, e);
    const ready = states.filter(s => s.state === 'ok').length;
    const todo = states.length - ready;
    const key = getAgnesKey();

    const cards = await Promise.all(states.map(async s => {
        const live = job && job.states.get(s.plan.id);
        const chipKey = live && live.state !== 'ok' ? live.state : s.state;
        const [cls, label] = STATE_CHIPS[chipKey] || STATE_CHIPS.missing;
        const extra = live && live.state === 'error' ? ' : ' + esc(live.message)
            : live && live.state === 'waiting' ? ' dans <span data-left="' + s.plan.id + '">' + (live.left || '') + '</span> s' : '';
        const sh = s.shot;
        const url = sh && sh.current ? await assetUrl(sh.current) : '';
        const vi = sh && sh.current ? sh.versions.indexOf(sh.current) : -1;
        const versions = sh && sh.versions.length > 1
            ? '<button type="button" class="char-btn" data-action="shot-version" data-plan="' + s.plan.id + '" data-dir="-1"' + (vi <= 0 || running ? ' disabled' : '') + '>◀</button>' +
              '<span class="d-ver">v' + (vi + 1) + '/' + sh.versions.length + '</span>' +
              '<button type="button" class="char-btn" data-action="shot-version" data-plan="' + s.plan.id + '" data-dir="1"' + (vi >= sh.versions.length - 1 || running ? ' disabled' : '') + '>▶</button>'
            : '';
        const refs = s.req.refs.map(r => r.role === 'style' ? 'image de style' : '@' + r.name).join(', ');
        return '<div class="d-shot-card" data-plan="' + s.plan.id + '">' +
            (url ? '<img class="d-shot" src="' + url + '" data-asset="' + sh.current + '" data-action="zoom-shot" alt="Image du plan ' + s.plan.id + '">'
                 : '<div class="d-shot empty">' + s.plan.id + '</div>') +
            '<div class="d-shot-info">' +
                '<div class="d-shot-top"><b>' + s.plan.id + '</b> <span class="d-chip ' + cls + '" data-chip="' + s.plan.id + '">' + label + extra + '</span></div>' +
                '<div class="d-shot-text">' + esc(s.plan.image) + '</div>' +
                '<div class="char-actions">' +
                    '<button type="button" class="char-btn" data-action="regen-plan" data-plan="' + s.plan.id + '"' + (running || !a.ok || !key ? ' disabled' : '') + '>' +
                        (url ? '↻ Régénérer' : '🎨 Générer') + '</button>' + versions +
                '</div>' +
                '<details class="d-prompt"><summary>Prompt envoyé</summary><pre>' + esc(s.req.prompt) + '</pre>' +
                    '<div class="d-shot-text">Références : ' + (refs || 'aucune') + '</div></details>' +
            '</div></div>';
    }));

    const genLabel = !todo ? '✅ Toutes les images sont prêtes'
        : '🎨 Générer ' + (todo === states.length ? 'les ' + plural(todo, 'image') : plural(todo, 'image') + ' manquante' + (todo > 1 ? 's' : ''));
    return {
        badge: 'EP.' + e.number + ' · ' + ready + '/' + states.length, badgeClass: ready === states.length ? 'ok' : '',
        html:
            '<div class="d-grid3">' +
                '<div class="control-row"><label class="control-label" for="d-img-model">Modèle</label><select id="d-img-model"' + dis + '>' +
                    IMAGE_MODELS.map(m => '<option value="' + m.id + '"' + (m.id === settings.model ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></div>' +
                '<div class="control-row"><label class="control-label" for="d-img-size">Qualité</label><select id="d-img-size"' + dis + '>' +
                    IMAGE_SIZES.map(m => '<option value="' + m.id + '"' + (m.id === settings.size ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></div>' +
                '<div class="control-row"><label class="control-label" for="d-img-refs">Images de référence</label><select id="d-img-refs"' + dis + '>' +
                    IMG.REF_MODES.map(m => '<option value="' + m.id + '"' + (m.id === settings.refs ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></div>' +
            '</div>' +
            (!key ? '<div class="lock-banner"><span>⚠️ Ajoutez votre clé Agnes dans l\'onglet Vidéos pour générer les images.</span><button type="button" class="char-btn" data-action="goto-videos">Onglet Vidéos</button></div>' : '') +
            (!a.ok ? '<div class="lock-banner"><span>❌ Corrigez le script (' + plural(a.errors.length, 'erreur') + ') avant de générer les images.</span></div>' : '') +
            (!ctx.project.style.locked && a.ok ? '<div class="lock-banner"><span>💡 Verrouillez le style de la série pour que toutes les images restent cohérentes.</span></div>' : '') +
            '<div class="queue-summary"><span class="progress-text">🖼️ ' + ready + '/' + plural(states.length, 'image') + ' à jour</span>' +
                '<span class="eta-text" id="d-job-line">' + esc(job ? job.line : (todo ? plural(todo, 'image') + ' à faire' : 'Tout est prêt')) + '</span></div>' +
            (running
                ? '<button type="button" class="btn-stop visible" data-action="stop-images">⏹ Arrêter la génération</button>'
                : '<button type="button" class="btn-primary" data-action="gen-images"' + (!todo || !a.ok || !key ? ' disabled' : '') + '>' + genLabel + '</button>') +
            '<div class="d-shots">' + cards.join('') + '</div>' +
            '<div class="api-hint">Les images sont gardées sur le téléphone. Une image n\'est refaite que si son plan, les fiches ou le style changent ; « Régénérer » propose une autre version (les 4 dernières sont gardées).</div>'
    };
}

async function startImages(planIds, force) {
    if (S.job && S.job.running) return;
    const ctx = await loadCtx();
    const e = ctx.episode;
    if (!e || !e.analysis || !e.analysis.ok) { toast('Corrigez d\'abord le script', 'warn'); return; }
    const ctrl = new AbortController();
    const states = new Map();
    const targets = planIds || e.analysis.plans.map(p => p.id);
    targets.forEach(id => states.set(id, { state: 'queued' }));
    const job = S.job = { pid: ctx.project.id, eid: e.id, ctrl, states, running: true, line: 'Préparation…' };
    if (typeof window.ensureWakeLockActive === 'function') window.ensureWakeLockActive();
    await refresh('images');
    let done = 0;
    const total = targets.length;
    try {
        const summary = await IMG.generateEpisodeImages({
            project: ctx.project, characters: ctx.chars, episode: e, planIds, force, signal: ctrl.signal,
            onUpdate: (planId, st) => {
                job.states.set(planId, st);
                if (st.state === 'ok' || st.state === 'error') done++;
                if (st.state === 'waiting') {
                    job.line = 'Nouvel essai dans ' + st.left + ' s (' + st.message + ')';
                    const left = root.querySelector('[data-left="' + planId + '"]');
                    if (left) {
                        left.textContent = st.left;
                        const ln = $('#d-job-line');
                        if (ln) ln.textContent = job.line;
                        return;
                    }
                } else {
                    job.line = st.state === 'running' ? 'Plan ' + planId + ' en création… (' + done + '/' + total + ')'
                        : done + '/' + total + ' traité' + (done > 1 ? 's' : '');
                }
                scheduleImagesRefresh();
            }
        });
        const parts = [];
        if (summary.generated) parts.push(plural(summary.generated, 'image') + ' créée' + (summary.generated > 1 ? 's' : ''));
        if (summary.reused) parts.push(summary.reused + ' reprise' + (summary.reused > 1 ? 's' : '') + ' du cache');
        if (summary.failed) parts.push(summary.failed + ' en échec');
        if (summary.keyRefused) toast('Clé Agnes refusée : vérifiez-la dans l\'onglet Vidéos', 'error', 4500);
        else if (summary.stopped) toast('Génération arrêtée', 'warn');
        else toast(parts.join(' · ') || 'Images déjà à jour', summary.failed ? 'warn' : 'success', 3500);
        job.line = summary.stopped ? 'Arrêté' : (parts.join(' · ') || 'Images déjà à jour');
    } catch (err) {
        fail(err);
        job.line = err.message;
    } finally {
        job.running = false;
        clearTimeout(S.imagesTimer);
        await refresh('episodes', 'images');
    }
}

function scheduleImagesRefresh() {
    clearTimeout(S.imagesTimer);
    S.imagesTimer = setTimeout(() => refresh('episodes', 'images').catch(fail), 120);
}

function showZoom(src) {
    const ov = document.createElement('div');
    ov.className = 'd-overlay';
    ov.innerHTML = '<img src="' + src + '" alt="">';
    ov.addEventListener('click', () => ov.remove());
    document.body.appendChild(ov);
}

// ─── Section Voix et durées ───────────────────────────────────────
const VOICE_CHIPS = {
    ok: ['ok', '✅ prête'], cached: ['soft', '♻️ en cache'], stale: ['warn', '♻️ à refaire (texte ou voix modifiés)'],
    missing: ['', '○ à générer'], queued: ['', '⏳ en attente'], running: ['run', '🎙️ synthèse…'],
    waiting: ['warn', '⏸ nouvel essai'], error: ['bad', '❌'], stopped: ['', '⏹ arrêté'],
    agnes: ['ok', '🎬 dite par Agnes dans le clip']
};
const fmtClock = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
// m:ss.d — moments des plans, au dixième de seconde
const fmtTenth = s => { const d = Math.round(s * 10) / 10; return Math.floor(d / 60) + ':' + (d % 60).toFixed(1).padStart(4, '0'); };

async function buildVoices(ctx) {
    const e = ctx.episode;
    if (!e) return { badge: '—', badgeClass: '', html: '<div class="char-empty">Créez un épisode dans « 📺 Épisodes ».</div>' };
    const a = e.analysis;
    if (!a || !a.plans.length) return { badge: 'EP.' + e.number, badgeClass: '', html: '<div class="char-empty">Écrivez le script de l\'épisode : chaque [VOIX] sera doublée.</div>' };

    const { states, timing } = await VO.voiceStates(ctx.project, ctx.chars, e);
    const job = S.vjob && S.vjob.eid === e.id ? S.vjob : null;
    const running = !!(S.vjob && S.vjob.running);
    const key = EL.getKey();
    const ready = states.filter(s => s.state === 'ok' || s.state === 'agnes').length;
    const todo = states.filter(s => !['ok', 'error', 'agnes'].includes(s.state)).length;
    const blocked = [...new Set(states.filter(s => s.state === 'error').map(s => s.req.error))];
    const byPlan = new Map();
    states.forEach(s => { if (!byPlan.has(s.line.planId)) byPlan.set(s.line.planId, []); byPlan.get(s.line.planId).push(s); });
    const target = a.stats.target;
    const inTarget = timing.total >= target.min && timing.total <= target.max;
    const model = M.ELEVEN_MODELS.find(m => m.id === ctx.project.voiceModel) || M.ELEVEN_MODELS[0];
    const playing = S.player && S.player.ctx;
    const hasOwn = states.some(s => s.state === 'ok');

    const plans = await Promise.all(timing.plans.map(async tp => {
        const lines = await Promise.all((byPlan.get(tp.id) || []).map(async s => {
            const live = job && job.states.get(s.line.id);
            const chipKey = live && live.state !== 'ok' ? live.state : s.state;
            const [cls, label0] = VOICE_CHIPS[chipKey] || VOICE_CHIPS.missing;
            const label = chipKey === 'ok' && s.micro ? '✅ enregistrée au micro' : label0;
            const msg = live && live.state === 'error' ? live.message : s.state === 'agnes' ? '' : s.state === 'error' ? s.req.error + ' — ou enregistrez-la au micro' : '';
            const extra = msg ? ' ' + esc(msg)
                : live && live.state === 'waiting' ? ' dans <span data-vleft="' + s.line.id + '">' + (live.left || '') + '</span> s' : '';
            const t = s.take;
            const vi = t && t.current ? t.versions.indexOf(t.current) : -1;
            const versions = t && t.versions.length > 1
                ? '<button type="button" class="char-btn" data-action="take-version" data-line="' + s.line.id + '" data-dir="-1"' + (vi <= 0 || running ? ' disabled' : '') + '>◀</button>' +
                  '<span class="d-ver">v' + (vi + 1) + '/' + t.versions.length + '</span>' +
                  '<button type="button" class="char-btn" data-action="take-version" data-line="' + s.line.id + '" data-dir="1"' + (vi >= t.versions.length - 1 || running ? ' disabled' : '') + '>▶</button>'
                : '';
            return '<div class="d-line" data-line="' + s.line.id + '">' +
                '<div class="d-line-top"><b>@' + esc(s.line.perso) + '</b>' + (s.line.ton ? ' <i>(' + esc(s.line.ton) + ')</i>' : '') +
                    ' <span class="d-chip ' + cls + '" data-vchip="' + s.line.id + '">' + label + extra + '</span>' +
                    (s.duration != null ? '<span class="d-line-dur">' + s.duration.toFixed(1) + ' s</span>' : '') + '</div>' +
                '<div class="d-shot-text">« ' + esc(s.line.texte) + ' »' + (s.micro ? ' — 🎤 votre voix' : s.req.voiceName ? ' — 🎙️ ' + esc(s.req.voiceName) : '') + '</div>' +
                (S.rec && S.rec.lineId === s.line.id
                    ? '<div class="d-rec"><span class="d-rec-dot"></span><span>Enregistrement… <b id="d-rec-time">0:00</b> — dites la réplique</span>' +
                      '<button type="button" class="char-btn d-rec-stop" data-action="rec-stop">⏹ Arrêter</button>' +
                      '<button type="button" class="char-btn" data-action="rec-cancel">Annuler</button></div>'
                    : '') +
                '<div class="char-actions">' +
                    (s.state === 'ok' ? '<button type="button" class="char-btn" data-action="play-line" data-line="' + s.line.id + '">▶ Écouter</button>' : '') +
                    (S.rec ? '' : '<button type="button" class="char-btn" data-action="rec-start" data-line="' + s.line.id + '"' + (running ? ' disabled' : '') + '>🎤 ' + (s.micro ? 'Réenregistrer' : 'Enregistrer') + '</button>') +
                    (s.state !== 'error' && s.state !== 'agnes' ? '<button type="button" class="char-btn" data-action="regen-line" data-line="' + s.line.id + '"' + (running || !a.ok || !key ? ' disabled' : '') + '>' +
                        (t && t.current ? '↻ Autre prise' : '🎙️ Générer') + '</button>' : '') + versions +
                '</div></div>';
        }));
        const modeLabel = tp.mode === 'audio' ? 'durée des voix' : tp.mode === 'estimate' ? 'estimation' : tp.mode === 'fixed' ? 'imposée' : tp.mode === 'clip' ? 'durée du clip' : 'sans réplique';
        return '<div class="d-vplan">' +
            '<div class="d-vplan-top"><b>' + tp.id + '</b><span class="d-vplan-time">' + fmtTenth(tp.start) + ' → ' + fmtTenth(tp.start + tp.duration) + '</span>' +
                '<span class="d-chip' + (tp.mode === 'audio' || tp.mode === 'default' || tp.mode === 'clip' ? ' ok' : tp.mode === 'estimate' ? '' : ' soft') + '">⏱ ' + tp.duration.toFixed(1) + ' s · ' + modeLabel + '</span></div>' +
            (tp.overflow ? '<div class="d-shot-text" style="color:#8a6510">⚠️ Les répliques dépassent la durée imposée.</div>' : '') +
            lines.join('') + '</div>';
    }));

    const genLabel = !todo ? '✅ Toutes les voix sont prêtes'
        : '🎙️ Générer ' + (todo === states.length ? 'les ' + plural(todo, 'réplique') : plural(todo, 'réplique') + ' manquante' + (todo > 1 ? 's' : ''));
    return {
        badge: 'EP.' + e.number + ' · ' + (states.length ? ready + '/' + states.length : 'sans réplique'),
        badgeClass: states.length && ready === states.length ? 'ok' : '',
        html:
            '<div class="api-hint" style="margin:0 0 0.6rem">Modèle : ' + esc(model.name) + ' · voix et réglages de chaque fiche (section Personnages).</div>' +
            (!key ? '<div class="lock-banner"><span>🎤 Enregistrez chaque réplique au micro, ou ajoutez une clé ElevenLabs en haut de l\'onglet Drama pour des voix de synthèse.</span><button type="button" class="char-btn" data-action="open-eleven">Ajouter la clé</button></div>' : '') +
            (!a.ok ? '<div class="lock-banner"><span>❌ Corrigez le script (' + plural(a.errors.length, 'erreur') + ') avant de générer les voix.</span></div>' : '') +
            blocked.map(b => '<div class="lock-banner"><span>⚠️ ' + esc(b) + '</span></div>').join('') +
            '<div class="queue-summary"><span class="progress-text">🎙️ ' + ready + '/' + plural(states.length, 'réplique') + ' prête' + (ready > 1 ? 's' : '') + '</span>' +
                '<span class="eta-text">⏱ Épisode : ' + fmtClock(timing.total) + (timing.complete ? '' : ' (estimation)') +
                ' <span class="' + (inTarget ? 'd-ok' : 'd-off') + '">objectif 3–6 min' + (inTarget ? ' ✓' : '') + '</span></span></div>' +
            (job ? '<div class="api-hint" id="d-vjob-line">' + esc(job.line) + '</div>' : '') +
            (running
                ? '<button type="button" class="btn-stop visible" data-action="stop-voices">⏹ Arrêter le doublage</button>'
                : '<button type="button" class="btn-primary" data-action="gen-voices"' + (!todo || !a.ok || !key ? ' disabled' : '') + '>' + genLabel + '</button>') +
            (hasOwn ? (playing
                ? '<button type="button" class="api-save-btn" data-action="stop-play">⏹ Arrêter l\'écoute <span id="d-play-clock"></span></button>'
                : '<button type="button" class="api-save-btn" data-action="play-episode">▶ Écouter l\'épisode (voix et durées)</button>') : '') +
            '<div class="d-vplans">' + plans.join('') + '</div>' +
            '<div class="api-hint">🎤 « Enregistrer » : dites la réplique puis touchez « Arrêter » ; les silences du début et de la fin sont retirés automatiquement. Une prise au micro reste valable tant que le texte ne change pas. ' +
            'Une prise ElevenLabs n\'est refaite que si le texte, la voix ou ses réglages changent ; « Autre prise » en propose une nouvelle (les 4 dernières sont gardées). Le ton entre parenthèses est indicatif : il n\'est pas transmis à ElevenLabs.</div>'
    };
}

async function startVoices(lineIds, force) {
    if (S.vjob && S.vjob.running) return;
    const ctx = await loadCtx();
    const e = ctx.episode;
    if (!e || !e.analysis || !e.analysis.ok) { toast('Corrigez d\'abord le script', 'warn'); return; }
    const ctrl = new AbortController();
    const states = new Map();
    const targets = lineIds || VO.episodeLines(e.analysis).map(l => l.id);
    targets.forEach(id => states.set(id, { state: 'queued' }));
    const job = S.vjob = { pid: ctx.project.id, eid: e.id, ctrl, states, running: true, line: 'Préparation…' };
    if (typeof window.ensureWakeLockActive === 'function') window.ensureWakeLockActive();
    await refresh('voices');
    let done = 0;
    try {
        const summary = await VO.generateEpisodeVoices({
            project: ctx.project, characters: ctx.chars, episode: e, lineIds, force, signal: ctrl.signal,
            onUpdate: (lid, st) => {
                job.states.set(lid, st);
                if (st.state === 'ok' || st.state === 'error') done++;
                if (st.state === 'waiting') {
                    job.line = 'Nouvel essai dans ' + st.left + ' s (' + st.message + ')';
                    const left = root.querySelector('[data-vleft="' + lid + '"]');
                    if (left) {
                        left.textContent = st.left;
                        const ln = $('#d-vjob-line');
                        if (ln) ln.textContent = job.line;
                        return;
                    }
                } else {
                    job.line = st.state === 'running' ? 'Réplique ' + lid + ' en cours… (' + done + '/' + targets.length + ')' : done + '/' + targets.length + ' traitée' + (done > 1 ? 's' : '');
                }
                clearTimeout(S.voicesTimer);
                S.voicesTimer = setTimeout(() => refresh('episodes', 'voices').catch(fail), 120);
            }
        });
        const parts = [];
        if (summary.generated) parts.push(plural(summary.generated, 'réplique') + ' doublée' + (summary.generated > 1 ? 's' : ''));
        if (summary.reused) parts.push(summary.reused + ' reprise' + (summary.reused > 1 ? 's' : '') + ' du cache');
        if (summary.failed) parts.push(summary.failed + ' en échec');
        if (summary.blocked) toast(summary.blocked, 'error', 4500);
        else if (summary.stopped) toast('Doublage arrêté', 'warn');
        else toast(parts.join(' · ') || 'Voix déjà à jour', summary.failed ? 'warn' : 'success', 3500);
        job.line = summary.stopped ? 'Arrêté' : (summary.blocked || parts.join(' · ') || 'Voix déjà à jour');
    } catch (err) {
        fail(err);
        job.line = err.message;
    } finally {
        job.running = false;
        clearTimeout(S.voicesTimer);
        await refresh('episodes', 'voices');
    }
}

// Écoute de l'épisode : toutes les prises placées à leur moment, silences compris.
async function playEpisode() {
    stopPlayback();
    const ctx = await loadCtx();
    const e = ctx.episode;
    if (!e) return;
    const { states, timing } = await VO.voiceStates(ctx.project, ctx.chars, e);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ac = new Ctx();
    const t0 = ac.currentTime + 0.15;
    const byLine = new Map(states.filter(s => s.state === 'ok').map(s => [s.line.id, s]));
    for (const tp of timing.plans) {
        for (const l of tp.lines) {
            const s = byLine.get(l.id);
            if (!s) continue;
            const asset = await M.getAsset(s.take.current);
            const buf = await ac.decodeAudioData(await asset.blob.arrayBuffer());
            const src = ac.createBufferSource();
            src.buffer = buf;
            src.connect(ac.destination);
            src.start(t0 + tp.start + l.start);
        }
    }
    const player = S.player = { ctx: ac, total: timing.total, timer: null };
    await refresh('voices');
    player.timer = setInterval(() => {
        const el = $('#d-play-clock');
        const pos = Math.max(0, ac.currentTime - t0);
        if (el) el.textContent = fmtClock(Math.min(pos, player.total)) + ' / ' + fmtClock(player.total);
        if (pos > player.total + 0.3) { stopPlayback(); refresh('voices').catch(fail); }
    }, 250);
}

function cancelRecording() {
    if (!S.rec) return;
    clearInterval(S.rec.timer);
    S.rec.session.cancel();
    S.rec = null;
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && S.rec) { cancelRecording(); toast('Enregistrement annulé (appli quittée)', 'warn'); refresh('voices').catch(() => {}); }
});

function stopPlayback() {
    const p = S.player;
    if (!p) return;
    if (p.timer) clearInterval(p.timer);
    if (p.ctx) p.ctx.close().catch(() => {});
    if (p.audio) p.audio.pause();
    S.player = null;
}

// ─── Section Animation des plans (Agnes) ──────────────────────────
const CLIP_CHIPS = {
    off: ['', '🖼️ image fixe'], noimage: ['warn', '🖼️ image du plan à générer d\'abord'], ok: ['ok', '✅ clip prêt'],
    pending: ['soft', '⏳ en préparation chez Agnes'], remote: ['warn', '⬇️ prêt chez Agnes : à télécharger puis importer'], cached: ['soft', '♻️ en cache'], stale: ['warn', '♻️ à refaire (image ou plan modifié)'],
    missing: ['', '○ à animer'], queued: ['', '⏳ en attente'], spacing: ['', '⏳ en attente'], creating: ['run', '🎬 envoi à Agnes…'],
    running: ['run', '🎬 animation…'], waiting: ['warn', '⏸ nouvel essai'], error: ['bad', '❌'], stopped: ['', '⏹ arrêté']
};
const fmtSec = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',') + ' s';

// Texte de la puce d'un plan pendant l'animation.
function clipChip(state, live) {
    const [cls, label] = CLIP_CHIPS[state] || CLIP_CHIPS.missing;
    if (!live) return [cls, label];
    if (state === 'spacing') return [cls, '⏳ envoi dans ' + live.left + ' s'];
    if (state === 'running') return [cls, '🎬 animation' + (live.progress ? ' ' + live.progress + ' %' : '…') +
        (live.message ? ' (' + live.message + ')' : live.left ? ' · vérification dans ' + live.left + ' s' : '')];
    if (state === 'waiting') return [cls, '⏸ nouvel essai dans ' + live.left + ' s (' + live.message + ')'];
    if (state === 'error') return [cls, '❌ ' + live.message];
    return [cls, label];
}

async function buildClips(ctx) {
    const e = ctx.episode;
    if (!e) return { badge: '—', badgeClass: '', html: '<div class="char-empty">Créez un épisode dans « 📺 Épisodes ».</div>' };
    const a = e.analysis;
    if (!a || !a.plans.length) return { badge: 'EP.' + e.number, badgeClass: '', html: '<div class="char-empty">Écrivez le script de l\'épisode : chaque [PLAN] pourra être animé.</div>' };
    const states = await CL.clipStates(ctx.project, ctx.chars, e);
    const job = S.cjob && S.cjob.eid === e.id ? S.cjob : null;
    const running = !!(S.cjob && S.cjob.running);
    const dis = running ? ' disabled' : '';
    const key = getAgnesKey();
    const animated = states.filter(s => s.animate);
    const ready = animated.filter(s => s.state === 'ok').length;
    const todo = animated.filter(s => !['ok', 'noimage'].includes(s.state));
    const remote = animated.filter(s => s.state === 'remote').length;
    const pending = animated.filter(s => s.state === 'pending').length;
    const noImage = animated.filter(s => s.state === 'noimage').length;
    const eta = todo.length ? (todo.length - pending - 1) * CL.CLIP_TIMING.createEvery + CL.estimateSeconds(121) : 0;

    const cards = await Promise.all(states.map(async s => {
        const id = s.plan.id;
        const live0 = job && job.states.get(id);
        const live = live0 && (job.running || live0.state === 'error') ? live0 : null;     // après coup : seules les erreurs restent
        const chipKey = live && live.state !== 'ok' ? live.state : s.state;
        const [cls, label] = clipChip(chipKey, live && live.state !== 'ok' ? live : null);
        const showClip = s.asset && (s.state === 'ok' || s.state === 'stale');
        const remoteUrl = s.state === 'remote' && s.clip.remote.url;
        const media = remoteUrl
            ? '<video class="d-shot" src="' + esc(remoteUrl) + '" data-action="zoom-clip" muted playsinline preload="metadata" aria-label="Clip du plan ' + id + ' chez Agnes"></video>'
            : showClip
            ? '<video class="d-shot" src="' + await assetUrl(s.asset.id) + '" data-asset="' + s.asset.id + '" data-action="zoom-clip" muted playsinline preload="metadata" aria-label="Clip du plan ' + id + ' (toucher pour lire)"></video>'
            : s.shotAssetId ? '<img class="d-shot" src="' + await assetUrl(s.shotAssetId) + '" data-asset="' + s.shotAssetId + '" data-action="zoom-shot" alt="Image du plan ' + id + '">'
            : '<div class="d-shot empty">' + id + '</div>';
        const c = s.clip;
        const vi = c && c.current ? c.versions.indexOf(c.current) : -1;
        const versions = c && c.versions.length > 1
            ? '<button type="button" class="char-btn" data-action="clip-version" data-plan="' + id + '" data-dir="-1"' + (vi <= 0 || running ? ' disabled' : '') + '>◀</button>' +
              '<span class="d-ver">v' + (vi + 1) + '/' + c.versions.length + '</span>' +
              '<button type="button" class="char-btn" data-action="clip-version" data-plan="' + id + '" data-dir="1"' + (vi >= c.versions.length - 1 || running ? ' disabled' : '') + '>▶</button>'
            : '';
        const said = s.plan.voix.map(v => '@' + esc(v.perso) + ' : « ' + esc(v.texte) + ' »').join('<br>');
        const warns = [];
        if (s.animate && s.tooLong) warns.push('⚠️ Plan de ' + fmtSec(s.need) + ' : un clip dure 10 s au plus, la dernière image restera figée. Coupez la réplique en deux plans.');
        if (s.short) warns.push('⚠️ Clip de ' + fmtSec(s.asset.duration) + ' pour un plan de ' + fmtSec(s.need) + ' : la dernière image reste affichée. « Autre clip » en demandera un plus long.');
        if (s.animate && s.audio === 'agnes' && s.state === 'ok' && s.asset && !s.asset.hasAudio) warns.push('⚠️ Ce clip n\'a pas de son : votre voix est utilisée.');
        const info = !s.animate ? ''
            : s.state === 'ok' && s.asset ? 'Clip ' + fmtSec(s.asset.duration) + (s.audio === 'agnes' && s.asset.hasAudio ? ' = durée du plan' : ' · plan ' + fmtSec(s.need))
            : 'Clip demandé : ' + fmtSec(CL.clipSeconds(s.frames)) + ' (plan ' + fmtSec(s.need) + ')';
        return '<div class="d-shot-card d-clip-card" data-cplan="' + id + '">' + media +
            '<div class="d-shot-info">' +
                '<div class="d-shot-top"><b>' + id + '</b> <span class="d-chip ' + cls + '" data-cchip="' + id + '">' + esc(label) + '</span></div>' +
                '<div class="d-shot-text">' + (said || 'Sans réplique : ' + esc(s.plan.image)) + '</div>' +
                '<label class="d-check"><input type="checkbox" data-clip-animate="' + id + '"' + (s.animate ? ' checked' : '') + dis + '> Animer ce plan</label>' +
                (s.animate && s.plan.voix.length
                    ? '<select class="d-clip-audio" data-clip-audio="' + id + '" aria-label="Voix du plan ' + id + '"' + dis + '>' +
                        '<option value="own"' + (s.audio === 'own' ? ' selected' : '') + '>🎤 Votre voix (micro ou ElevenLabs)</option>' +
                        '<option value="agnes"' + (s.audio === 'agnes' ? ' selected' : '') + '>🎬 Voix d\'Agnes (lèvres parfaites)</option></select>'
                    : '') +
                (info ? '<div class="d-shot-text">' + info + '</div>' : '') +
                warns.map(w => '<div class="d-shot-text d-warn">' + w + '</div>').join('') +
                (remoteUrl
                    ? '<div class="d-shot-text d-warn">Le clip est prêt, mais Agnes ne laisse pas l\'appli le télécharger elle-même. ' +
                        '1. Touchez « ⬇️ Ouvrir le clip », puis ⋮ → Télécharger. 2. Revenez ici et touchez « 📥 Importer le clip » : choisissez la vidéo téléchargée.</div>' +
                      '<div class="char-actions"><a class="char-btn" href="' + esc(remoteUrl) + '" target="_blank" rel="noopener" download>⬇️ Ouvrir le clip</a>' +
                      '<button type="button" class="char-btn" data-action="import-clip" data-plan="' + id + '"' + dis + '>📥 Importer le clip</button></div>'
                    : '') +
                (s.animate || (c && c.current)
                    ? '<div class="char-actions">' +
                        '<button type="button" class="char-btn" data-action="regen-clip" data-plan="' + id + '"' + (running || !a.ok || !key || s.state === 'noimage' ? ' disabled' : '') + '>' +
                            (c && c.current ? '↻ Autre clip' : '🎬 Animer ce plan') + '</button>' + versions +
                        (!remoteUrl && s.state !== 'noimage' ? '<button type="button" class="char-btn" data-action="import-clip" data-plan="' + id + '"' + dis + '>📥 Importer une vidéo</button>' : '') + '</div>'
                    : '') +
                (s.req.prompt ? '<details class="d-prompt"><summary>Prompt envoyé</summary><pre>' + esc(s.req.prompt) + '</pre></details>' : '') +
            '</div></div>';
    }));

    const genLabel = !todo.length ? (animated.length ? '✅ Tous les plans cochés sont animés' : 'Cochez les plans à animer')
        : '🎬 Animer ' + plural(todo.length, 'plan') + (pending ? ' (' + pending + ' en préparation)' : '');
    return {
        badge: 'EP.' + e.number + ' · ' + ready + '/' + animated.length, badgeClass: animated.length && ready === animated.length ? 'ok' : '',
        html:
            '<p class="char-intro">Agnes anime l\'image des plans cochés : le personnage bouge et dit sa réplique (lèvres qui bougent). ' +
                'Le montage utilise alors le clip à la place de l\'image fixe. Voix : 🎤 la vôtre par défaut (lèvres approximatives) ou 🎬 celle d\'Agnes, synchronisée avec les lèvres (la durée du plan devient celle du clip).</p>' +
            (!key ? '<div class="lock-banner"><span>⚠️ Ajoutez votre clé Agnes dans l\'onglet Vidéos pour animer les plans.</span><button type="button" class="char-btn" data-action="goto-videos">Onglet Vidéos</button></div>' : '') +
            (!a.ok ? '<div class="lock-banner"><span>❌ Corrigez le script (' + plural(a.errors.length, 'erreur') + ') avant d\'animer les plans.</span></div>' : '') +
            (remote ? '<div class="lock-banner"><span>⬇️ ' + plural(remote, 'clip') + ' prêt' + (remote > 1 ? 's' : '') + ' chez Agnes à télécharger puis importer (voir ' + (remote > 1 ? 'les plans' : 'le plan') + ' ci-dessous).</span></div>' : '') +
            (noImage ? '<div class="lock-banner"><span>🖼️ ' + plural(noImage, 'plan') + ' coché' + (noImage > 1 ? 's' : '') + ' sans image : générez d\'abord les images (section Images).</span></div>' : '') +
            '<div class="queue-summary"><span class="progress-text">🎬 ' + ready + '/' + plural(animated.length, 'plan') + ' animé' + (ready > 1 ? 's' : '') + '</span>' +
                '<span class="eta-text" id="d-cjob-line">' + esc(job ? job.line : todo.length ? '≈ ' + fmtDuration(eta) + ' (une demande toutes les ' + CL.CLIP_TIMING.createEvery + ' s)' : 'Tout est prêt') + '</span></div>' +
            (running && job
                ? '<button type="button" class="btn-stop visible" data-action="stop-clips">⏹ Arrêter l\'animation</button>' +
                  '<div class="api-hint">Gardez l\'appli ouverte : elle se met en pause si vous la quittez. Une animation déjà envoyée continue chez Agnes et sera reprise.</div>'
                : '<button type="button" class="btn-primary" data-action="gen-clips"' + (!todo.length || !a.ok || !key || running ? ' disabled' : '') + '>' + genLabel + '</button>') +
            '<div class="d-shots">' + cards.join('') + '</div>' +
            '<div class="api-hint">Chaque clip dure 5, 6,4 ou 10 s selon la durée du plan (une réplique de plus de 10 s doit être coupée en deux plans). Un clip n\'est refait que si l\'image ou le plan changent ; « Autre clip » en propose un nouveau (les 4 derniers sont gardés).</div>'
    };
}

async function startClips(planIds, force) {
    if (S.cjob && S.cjob.running) return;
    const ctx = await loadCtx();
    const e = ctx.episode;
    if (!e || !e.analysis || !e.analysis.ok) { toast('Corrigez d\'abord le script', 'warn'); return; }
    const ctrl = new AbortController();
    const job = S.cjob = { pid: ctx.project.id, eid: e.id, ctrl, states: new Map(), running: true, line: 'Préparation…' };
    if (typeof window.ensureWakeLockActive === 'function') window.ensureWakeLockActive();
    await refresh('clips');
    let finished = 0;
    try {
        const summary = await CL.generateEpisodeClips({
            project: ctx.project, characters: ctx.chars, episode: e, planIds, force, signal: ctrl.signal,
            onUpdate: (planId, st) => {
                job.states.set(planId, st);
                if (['ok', 'error', 'stopped'].includes(st.state)) finished++;
                const busy = [...job.states.values()].filter(x => ['running', 'creating', 'waiting'].includes(x.state)).length;
                job.line = busy ? plural(busy, 'plan') + ' en cours chez Agnes · ' + finished + ' terminé' + (finished > 1 ? 's' : '') : finished + ' terminé' + (finished > 1 ? 's' : '');
                const ln = $('#d-cjob-line');
                if (ln) ln.textContent = job.line;
                const chip = root.querySelector('[data-cchip="' + planId + '"]');
                if (chip && !['ok', 'error', 'stopped'].includes(st.state)) {     // en cours : seule la puce change
                    const [cls, text] = clipChip(st.state, st);
                    chip.className = 'd-chip ' + cls;
                    chip.textContent = text;
                    return;
                }
                clearTimeout(S.clipsTimer);
                S.clipsTimer = setTimeout(() => refresh('episodes', 'clips', 'voices').catch(fail), 150);
            }
        });
        const parts = [];
        if (summary.generated) parts.push(plural(summary.generated, 'clip') + ' créé' + (summary.generated > 1 ? 's' : ''));
        if (summary.reused) parts.push(summary.reused + ' repris du cache');
        if (summary.failed) parts.push(summary.failed + ' en échec');
        if (summary.remote) parts.push(summary.remote + ' à télécharger puis importer');
        if (summary.keyRefused) toast('Clé Agnes refusée : vérifiez-la dans l\'onglet Vidéos', 'error', 4500);
        else if (summary.stopped) toast('Animation arrêtée : les créations déjà envoyées seront reprises', 'warn', 4000);
        else toast(parts.join(' · ') || 'Clips déjà à jour', summary.failed || summary.remote ? 'warn' : 'success', summary.remote ? 5000 : 3500);
        job.line = summary.stopped ? 'Arrêté' : (parts.join(' · ') || 'Clips déjà à jour');
    } catch (err) {
        fail(err);
        job.line = err.message;
    } finally {
        job.running = false;
        clearTimeout(S.clipsTimer);
        await refresh('episodes', 'clips', 'voices');
    }
}

// ─── Section Montage ──────────────────────────────────────────────
async function buildMontage(ctx) {
    const e = ctx.episode;
    S.montageTl = null;
    if (!e) return { badge: '—', badgeClass: '', html: '<div class="char-empty">Créez un épisode dans « 📺 Épisodes ».</div>' };
    const a = e.analysis;
    if (!a || !a.ok || !a.plans.length) {
        return { badge: 'EP.' + e.number, badgeClass: '', html: '<div class="char-empty">Le montage s\'affiche dès que le script de l\'épisode est prêt (sans erreur).</div>' };
    }
    const tl = S.montageTl = await PL.loadEpisodeTimeline(ctx.project, ctx.chars, e);
    const st = tl.settings;
    const need = requiredSounds(a);
    const lib = await M.listLibrary(ctx.project.id);
    const libBy = (kind, name) => lib.find(x => x.kind === kind && x.name === name);
    const miss = tl.missing;
    const nImg = tl.plans.length - miss.images.length, nVox = tl.voices.length - miss.voices.length;
    const nMus = need.music.length - miss.music.length, nSfx = need.sfx.length - miss.sfx.length;
    const complete = !miss.images.length && !miss.voices.length && !miss.music.length && !miss.sfx.length;
    const nClips = tl.plans.filter(p => p.clip).length;
    const t = S.preview && S.preview.tl ? Math.min(S.preview.t, tl.duration) : 0;

    const soundRow = (kind, item) => {
        const x = libBy(kind, item.name);
        return '<div class="d-sound">' +
            '<div class="d-sound-main"><b>' + (kind === 'music' ? '🎵 ' : '🔊 ') + esc(item.label) + '</b>' +
                '<div class="d-shot-text">' + (x ? '✅ ' + esc(x.fileName || 'importé') + ' · ' + fmtTenth(x.duration) : '⚠️ à importer') + '</div></div>' +
            '<div class="char-actions">' +
                (x ? '<button type="button" class="char-btn" data-action="lib-play" data-asset="' + x.id + '">▶</button>' : '') +
                '<button type="button" class="char-btn" data-action="lib-import" data-kind="' + kind + '" data-name="' + esc(item.name) + '" data-label="' + esc(item.label) + '">' + (x ? 'Remplacer' : 'Importer') + '</button>' +
                (x ? '<button type="button" class="char-btn danger" data-action="lib-delete" data-asset="' + x.id + '">🗑</button>' : '') +
            '</div></div>';
    };
    const extra = lib.filter(x => !need[x.kind === 'music' ? 'music' : 'sfx'].some(n => n.name === x.name));

    return {
        badge: 'EP.' + e.number + ' · ' + fmtClock(tl.duration), badgeClass: complete ? 'ok' : '',
        html:
            '<div class="queue-summary"><span class="progress-text">🖼️ ' + nImg + '/' + tl.plans.length + (nClips ? ' · 🎬 ' + nClips : '') + ' · 🎙️ ' + nVox + '/' + tl.voices.length +
                (need.music.length ? ' · 🎵 ' + nMus + '/' + need.music.length : '') + (need.sfx.length ? ' · 🔊 ' + nSfx + '/' + need.sfx.length : '') + '</span>' +
                '<span class="eta-text">⏱ ' + fmtClock(tl.duration) + '</span></div>' +
            (complete ? '' : '<div class="api-hint" style="margin:0 0 0.6rem">L\'aperçu fonctionne déjà : ' +
                [miss.images.length ? plural(miss.images.length, 'image') + ' à générer (fond sombre)' : '',
                 miss.voices.length ? plural(miss.voices.length, 'réplique') + ' sans voix (durée estimée, sous-titre affiché)' : '',
                 miss.music.length ? plural(miss.music.length, 'musique') + ' à importer' : '',
                 miss.sfx.length ? plural(miss.sfx.length, 'bruitage') + ' à importer' : ''].filter(Boolean).join(' · ') + '.</div>') +
            '<div class="d-player"><canvas id="d-canvas" width="540" height="960" aria-label="Aperçu du montage"></canvas></div>' +
            '<div class="d-controls">' +
                '<button type="button" class="api-save-btn" id="d-preview-btn" data-action="preview-play">▶ Lire l\'aperçu</button>' +
                '<input type="range" id="d-seek" min="0" max="' + tl.duration + '" step="0.01" value="' + t + '" aria-label="Position dans l\'épisode">' +
                '<div class="d-time"><span id="d-time">' + fmtTenth(t) + ' / ' + fmtTenth(tl.duration) + '</span><span id="d-plan-label"></span></div>' +
            '</div>' +
            '<div class="control-label" style="margin:1rem 0 0.5rem">Réglages du montage (toute la série)</div>' +
            '<div class="d-grid2">' +
                '<div class="control-row"><label class="control-label" for="d-sub-on">Sous-titres</label><select id="d-sub-on">' +
                    '<option value="1"' + (st.subtitles ? ' selected' : '') + '>Incrustés</option><option value="0"' + (st.subtitles ? '' : ' selected') + '>Sans</option></select></div>' +
                '<div class="control-row"><label class="control-label" for="d-sub-size">Taille</label><select id="d-sub-size">' +
                    Object.keys(SUB_SIZES).map(k => '<option value="' + k + '"' + (k === st.subSize ? ' selected' : '') + '>' + { S: 'Petite', M: 'Moyenne', L: 'Grande' }[k] + '</option>').join('') + '</select></div>' +
            '</div>' +
            '<div class="control-row"><div class="d-slider"><span>Volume de la musique</span><span id="d-music-vol-val">' + Math.round(st.musicVolume * 100) + ' %</span></div>' +
                '<input type="range" id="d-music-vol" min="0" max="1" step="0.05" value="' + st.musicVolume + '"></div>' +
            '<div class="control-row"><div class="d-slider"><span>Musique pendant les voix</span><span id="d-duck-val">' + Math.round(st.duck * 100) + ' %</span></div>' +
                '<input type="range" id="d-duck" min="0" max="1" step="0.05" value="' + st.duck + '"></div>' +
            '<div class="control-label" style="margin:1rem 0 0.5rem">Bibliothèque sonore de la série</div>' +
            (need.music.length || need.sfx.length
                ? need.music.map(m => soundRow('music', m)).join('') + need.sfx.map(x => soundRow('sfx', x)).join('')
                : '<div class="char-empty">Le script n\'appelle ni [MUSIQUE] ni [SFX].</div>') +
            (extra.length ? '<div class="api-hint">Autres sons de la série : ' + extra.map(x => esc(x.label) + ' <button type="button" class="char-btn danger" data-action="lib-delete" data-asset="' + x.id + '">🗑</button>').join(' ') + '</div>' : '') +
            '<div class="api-hint">Un son importé porte le nom utilisé dans le script ([MUSIQUE] tension, [SFX] porte-claque) et sert à tous les épisodes de la série. La musique boucle si elle est plus courte que la scène.</div>'
    };
}

function updatePreviewUI(st) {
    const seek = $('#d-seek'), time = $('#d-time'), btn = $('#d-preview-btn'), lbl = $('#d-plan-label');
    if (seek && document.activeElement !== seek) seek.value = st.t;
    if (time) time.textContent = fmtTenth(st.t) + ' / ' + fmtTenth(st.duration);
    if (btn) btn.textContent = st.loading ? '⏳ Préparation du son…' : st.playing ? '⏸ Pause' : '▶ Lire l\'aperçu';
    if (lbl && st.plan) lbl.textContent = st.plan;
}

function attachPreview() {
    const canvas = $('#d-canvas');
    if (!canvas || !S.montageTl) { if (S.preview) S.preview.pause(); return; }
    if (!S.preview) S.preview = new PL.Player(updatePreviewUI);
    S.preview.attach(canvas, S.montageTl);
}

// ─── Section Export ───────────────────────────────────────────────
const fmtSize = b => b >= 1e6 ? (b / 1e6).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(b / 1e3)) + ' Ko';
const seriesSlug = name => M.normalizeName(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'serie';

async function buildExport(ctx) {
    const e = ctx.episode;
    if (!e) return { badge: '—', badgeClass: '', html: '<div class="char-empty">Créez un épisode dans « 📺 Épisodes ».</div>' };
    const a = e.analysis;
    if (!a || !a.ok || !a.plans.length) return { badge: 'EP.' + e.number, badgeClass: '', html: '<div class="char-empty">L\'export est possible dès que le script de l\'épisode est prêt (sans erreur).</div>' };
    const tl = await PL.loadEpisodeTimeline(ctx.project, ctx.chars, e);
    const hash = EX.timelineHash(tl);
    if (!S.codecs) S.codecs = await EX.pickCodecs().catch(err => ({ error: err.message }));
    const cd = S.codecs;
    const info = e.exportInfo;
    const file = info ? await EX.getExportFile(info.file) : null;
    const upToDate = !!(file && info.tlHash === hash);
    const job = S.xjob && S.xjob.eid === e.id && S.xjob.running ? S.xjob : null;
    const busy = !!((S.xjob && S.xjob.running) || (S.bjob && S.bjob.running));
    const miss = tl.missing;
    const warn = [miss.images.length ? plural(miss.images.length, 'image') + ' manquante' + (miss.images.length > 1 ? 's' : '') + ' (fond sombre)' : '',
        miss.voices.length ? plural(miss.voices.length, 'réplique') + ' sans voix (sous-titre seul)' : '',
        miss.music.length ? plural(miss.music.length, 'musique') + ' à importer' : '',
        miss.sfx.length ? plural(miss.sfx.length, 'bruitage') + ' à importer' : ''].filter(Boolean);

    if (file && (!S.exportUrl || S.exportUrl.name !== info.file + ':' + info.createdAt)) {
        if (S.exportUrl) URL.revokeObjectURL(S.exportUrl.url);
        S.exportUrl = { name: info.file + ':' + info.createdAt, url: URL.createObjectURL(file) };
    }
    const thumbUrl = e.thumb ? await assetUrl(e.thumb.assetId) : '';
    const planOpts = tl.plans.map(p => '<option value="' + p.id + '"' + ((e.thumb ? e.thumb.planId : (tl.plans.find(x => x.imageAssetId) || {}).id) === p.id ? ' selected' : '') + '>' +
        p.id + ' — ' + esc(String((a.plans[p.index] || {}).image || '').slice(0, 40)) + '</option>').join('');

    return {
        badge: upToDate ? 'EP.' + e.number + ' · ✅ MP4' : file ? 'EP.' + e.number + ' · à refaire' : 'EP.' + e.number,
        badgeClass: upToDate ? 'ok' : '',
        html:
            '<div class="api-hint" style="margin:0 0 0.6rem">MP4 vertical 1080×1920, 30 images/s, ' + fmtClock(tl.duration) + ' — fabriqué sur le téléphone.</div>' +
            (cd.error ? '<div class="lock-banner"><span>⚠️ ' + esc(cd.error) + '</span></div>'
                : '<div class="wake-status ' + (cd.compatible ? 'active' : 'warn') + '"><span>' + (cd.compatible
                    ? '🎬 Format : ' + cd.video.label + ' + ' + cd.audio.label + ' — accepté par TikTok, YouTube, Instagram, Facebook et Snapchat'
                    : '🎬 Format : ' + cd.video.label + ' + ' + cd.audio.label + ' — ce téléphone ne produit pas le H.264 ; YouTube l\'accepte, d\'autres réseaux peuvent le refuser') + '</span></div>') +
            (warn.length ? '<div class="lock-banner"><span>⚠️ À compléter pour un épisode fini : ' + warn.join(' · ') + '. L\'export reste possible.</span></div>' : '') +
            (job
                ? '<div class="d-xprog"><div class="d-xbar"><div class="d-xfill" id="d-xfill" style="width:' + exportPercent(job) + '%"></div></div>' +
                  '<div class="api-hint" id="d-xtext">' + esc(exportText(job)) + '</div></div>' +
                  '<button type="button" class="btn-stop visible" data-action="stop-export">⏹ Arrêter l\'export</button>' +
                  '<div class="api-hint">Gardez l\'appli ouverte : l\'export se met en pause si vous la quittez et reprend au retour.</div>'
                : '<button type="button" class="btn-primary" data-action="start-export"' + (cd.error || busy ? ' disabled' : '') + '>' +
                  (file ? (upToDate ? '📤 Exporter à nouveau' : '📤 Mettre l\'export à jour') : '📤 Exporter l\'épisode en MP4') + '</button>') +
            (file
                ? '<div class="d-export">' +
                    '<div class="d-export-top"><b>' + esc(seriesSlug(ctx.project.name) + '-ep' + e.number + '.mp4') + '</b>' +
                        '<span class="d-chip ' + (upToDate ? 'ok' : 'warn') + '">' + (upToDate ? '✅ à jour' : '⚠️ montage modifié depuis l\'export') + '</span></div>' +
                    '<div class="d-shot-text">' + fmtSize(file.size) + ' · ' + fmtClock(info.duration) + ' · ' + esc(info.codecs) + ' · ' + fmtDate(info.createdAt) + '</div>' +
                    '<video class="d-export-video" controls playsinline preload="metadata" src="' + S.exportUrl.url + '"></video>' +
                    '<div class="char-actions"><button type="button" class="char-btn" data-action="save-export">💾 Enregistrer sur le téléphone</button>' +
                    '<button type="button" class="char-btn danger" data-action="delete-export"' + (busy ? ' disabled' : '') + '>🗑 Supprimer</button></div>' +
                  '</div>'
                : '') +
            '<div class="control-label" style="margin:1rem 0 0.5rem">Vignette « EP.' + e.number + ' »</div>' +
            '<div class="d-thumb-row">' +
                (thumbUrl ? '<img class="d-thumb" src="' + thumbUrl + '" data-asset="' + e.thumb.assetId + '" data-action="zoom-shot" alt="Vignette EP.' + e.number + '">' : '<div class="d-thumb empty">EP.' + e.number + '</div>') +
                '<div class="d-thumb-ctrl">' +
                    '<label class="control-label" for="d-thumb-plan">Image du plan</label><select id="d-thumb-plan">' + planOpts + '</select>' +
                    '<div class="char-actions"><button type="button" class="char-btn" data-action="make-thumb">🖼️ ' + (thumbUrl ? 'Refaire' : 'Créer') + ' la vignette</button>' +
                    (thumbUrl ? '<button type="button" class="char-btn" data-action="save-thumb">💾 Enregistrer</button>' : '') + '</div>' +
                '</div>' +
            '</div>'
    };
}

function exportPercent(job) {
    if (job.phase === 'son') return 3;
    if (job.phase === 'fin') return 100;
    return Math.round(5 + 94 * (job.done / Math.max(1, job.total)));
}
function exportText(job) {
    if (job.phase === 'son') return '🎧 Mixage du son…';
    if (job.phase === 'fin') return '📦 Finalisation du fichier…';
    if (job.phase !== 'images') return 'Préparation…';
    const elapsed = (Date.now() - job.imagesStart) / 1000;
    const encoded = job.done - (job.reused || 0);            // images reprises : instantanées, hors estimation
    const rate = encoded / Math.max(0.1, elapsed);
    const left = rate > 0 ? (job.total - job.done) / rate : 0;
    return '🎞️ Image ' + job.done + '/' + job.total + (encoded > 30 ? ' · encore ~' + fmtClock(left) : '');
}

// Exporte un épisode (moteur commun à l'export simple et au rendu en lot).
async function exportOneEpisode(project, chars, e, signal, onProgress) {
    if (!e.analysis || !e.analysis.ok) throw new Error('Script de l\'EP.' + e.number + ' à corriger');
    const tl = await PL.loadEpisodeTimeline(project, chars, e);
    const fileName = e.id + '.mp4';
    if (e.exportInfo) await EX.deleteExportFile(e.exportInfo.file);
    await M.updateEpisode(e.id, { exportInfo: null });
    const res = await EX.exportEpisode({ tl, projectId: project.id, episodeId: e.id, fileName, signal, onProgress });
    await M.updateEpisode(e.id, { exportInfo: {
        file: fileName, size: res.file.size, duration: tl.duration, codecs: res.codecs, compatible: res.compatible,
        frames: res.frames, encoded: res.encoded, reused: res.reused, tlHash: EX.timelineHash(tl), createdAt: Date.now()
    }});
    return { size: res.file.size, encoded: res.encoded, reused: res.reused };
}

function trackProgress(job, p) {
    if (p.phase === 'images' && job.phase !== 'images') { job.imagesStart = Date.now(); job.reusedAtStart = p.reused || 0; }
    job.phase = p.phase; job.done = p.done; job.total = p.total; job.reused = p.reused || 0;
}

async function startExport() {
    if ((S.xjob && S.xjob.running) || (S.bjob && S.bjob.running)) return;
    const ctx = await loadCtx();
    const e = ctx.episode;
    if (!e || !e.analysis || !e.analysis.ok) { toast('Corrigez d\'abord le script', 'warn'); return; }
    if (S.preview) S.preview.pause();
    stopPlayback();
    const ctrl = new AbortController();
    const job = S.xjob = { eid: e.id, ctrl, running: true, phase: 'prep', done: 0, total: 1, started: Date.now(), imagesStart: 0 };
    if (typeof window.ensureWakeLockActive === 'function') window.ensureWakeLockActive();
    await refresh('export');
    try {
        const res = await exportOneEpisode(ctx.project, ctx.chars, e, ctrl.signal, p => {
            trackProgress(job, p);
            const fill = $('#d-xfill'), txt = $('#d-xtext');
            if (fill) fill.style.width = exportPercent(job) + '%';
            if (txt) txt.textContent = exportText(job);
        });
        toast('EP.' + e.number + ' exporté : ' + fmtSize(res.size) + (res.reused ? ' (' + res.reused + ' images reprises)' : ''), 'success', 3500);
    } catch (err) {
        if (err.name === 'AbortError') toast('Export arrêté : les plans déjà encodés sont gardés, relancez pour reprendre', 'warn', 4500);
        else fail(err);
    } finally {
        job.running = false;
        await refresh('export', 'episodes');
    }
}

// ─── Section Rendu en lot ─────────────────────────────────────────
async function buildBatch(ctx) {
    const eps = ctx.episodes;
    if (!eps.length) return { badge: '—', badgeClass: '', html: '<div class="char-empty">Aucun épisode.</div>' };
    const b = BT.loadBatch();
    const mine = b && b.projectId === ctx.project.id ? b : null;
    const running = !!(S.bjob && S.bjob.running);
    const states = await Promise.all(eps.map(async e => {
        const ok = !!(e.analysis && e.analysis.ok && e.analysis.plans.length);
        let state = 'never';
        if (!ok) state = 'script';
        else if (e.exportInfo && await EX.getExportFile(e.exportInfo.file)) {
            const tl = await PL.loadEpisodeTimeline(ctx.project, ctx.chars, e);
            state = e.exportInfo.tlHash === EX.timelineHash(tl) ? 'uptodate' : 'stale';
        }
        return { e, ok, state };
    }));
    // présélection : les épisodes prêts dont l'export manque ou est à refaire (tant que l'utilisateur n'a rien coché)
    if (!S.batchSel || !S.batchSelTouched) S.batchSel = new Set(states.filter(x => x.ok && x.state !== 'uptodate').map(x => x.e.id));
    for (const id of [...S.batchSel]) if (!states.some(x => x.e.id === id && x.ok)) S.batchSel.delete(id);
    const LABEL = { uptodate: ['ok', '✅ MP4 à jour'], stale: ['warn', '⚠️ à refaire'], never: ['', '○ pas encore exporté'], script: ['bad', '❌ script à corriger'] };
    const RES = { pending: ['', '⏳ en attente'], running: ['run', '🎞️ en cours'], done: ['ok', '✅ exporté'], error: ['bad', '❌ échec'], stopped: ['warn', '⏸ arrêté'] };
    const sel = [...S.batchSel];
    const cur = running ? S.bjob : null;
    const resumable = !running && BT.interrupted(mine);

    const rows = states.map(x => {
        const [cls, label] = LABEL[x.state];
        const r = mine && mine.results[x.e.id];
        const [rcls, rlabel] = r ? RES[r.state] || ['', r.state] : ['', ''];
        return '<label class="d-brow' + (x.ok ? '' : ' off') + '">' +
            '<input type="checkbox" data-bsel="' + x.e.id + '"' + (S.batchSel.has(x.e.id) ? ' checked' : '') + (x.ok && !running ? '' : ' disabled') + '>' +
            '<span class="d-brow-main"><b>EP.' + x.e.number + '</b> ' + esc(x.e.title) +
                '<span class="d-shot-text"><span class="d-chip ' + cls + '">' + label + '</span>' +
                (r ? ' <span class="d-chip ' + rcls + '">' + rlabel + '</span>' : '') +
                (r && r.state === 'done' ? ' ' + fmtSize(r.size) + (r.reused ? ' · ' + r.reused + ' images reprises' : '') : '') +
                (r && r.message ? ' ' + esc(r.message) : '') + '</span></span></label>';
    }).join('');

    return {
        badge: running ? '🎞️ en cours' : resumable ? '⏸ interrompu' : mine && mine.finishedAt ? BT.doneCount(mine) + '/' + mine.ids.length + ' faits' : '',
        badgeClass: running ? 'soft' : resumable ? 'bad' : mine && mine.finishedAt && BT.doneCount(mine) === mine.ids.length ? 'ok' : '',
        html:
            '<p class="char-intro">Exportez plusieurs épisodes à la suite. Chaque plan encodé est gardé : après une coupure, une erreur ou une petite modification, seuls les plans manquants ou modifiés sont refaits.</p>' +
            (resumable ? '<div class="lock-banner"><span>⏸ Rendu en lot interrompu : ' + BT.doneCount(mine) + '/' + mine.ids.length + ' épisode' + (mine.ids.length > 1 ? 's' : '') + ' fait' + (BT.doneCount(mine) > 1 ? 's' : '') + '.</span>' +
                '<button type="button" class="char-btn" data-action="batch-resume">▶ Reprendre</button><button type="button" class="char-btn" data-action="batch-forget">Abandonner</button></div>' : '') +
            '<div class="d-blist">' + rows + '</div>' +
            (cur
                ? '<div class="d-xprog"><div class="d-xbar"><div class="d-xfill" id="d-bfill" style="width:' + batchPercent(cur, mine) + '%"></div></div>' +
                  '<div class="api-hint" id="d-btext">' + esc(batchText(cur, mine, eps)) + '</div></div>' +
                  '<button type="button" class="btn-stop visible" data-action="batch-stop">⏹ Arrêter le lot</button>' +
                  '<div class="api-hint">Gardez l\'appli ouverte : le rendu se met en pause si vous la quittez. S\'il est interrompu, « Reprendre » repart du dernier plan encodé.</div>'
                : '<button type="button" class="btn-primary" data-action="batch-start"' + (!sel.length || (S.xjob && S.xjob.running) ? ' disabled' : '') + '>🗂️ Exporter ' +
                  (sel.length ? plural(sel.length, 'épisode') : 'la sélection') + '</button>')
    };
}

function batchPercent(job, b) {
    if (!b) return 0;
    const n = b.ids.length, idx = Math.max(0, b.ids.indexOf(job.eid));
    const inner = job.phase === 'images' ? job.done / Math.max(1, job.total) * 0.95 : job.phase === 'son' ? 0.96 : job.phase === 'fin' ? 0.99 : 0;
    return Math.round((idx + inner) / n * 100);
}
function batchText(job, b, eps) {
    const e = eps.find(x => x.id === job.eid);
    const head = 'Épisode ' + (b.ids.indexOf(job.eid) + 1) + '/' + b.ids.length + (e ? ' · EP.' + e.number : '');
    return head + ' — ' + exportText(job) + (job.reused ? ' · ' + job.reused + ' images reprises' : '');
}

async function runBatchUI(b) {
    if ((S.bjob && S.bjob.running) || (S.xjob && S.xjob.running)) return;
    if (S.preview) S.preview.pause();
    stopPlayback();
    const ctrl = new AbortController();
    const job = S.bjob = { ctrl, running: true, eid: null, phase: 'prep', done: 0, total: 1 };
    if (typeof window.ensureWakeLockActive === 'function') window.ensureWakeLockActive();
    await refresh('batch');
    try {
        const out = await BT.runBatch(b, {
            signal: ctrl.signal,
            exportOne: async (eid, signal, onProgress) => {
                const ctx = await loadCtx();
                const e = (await M.listEpisodes(b.projectId)).find(x => x.id === eid);
                if (!e) throw new Error('Épisode supprimé');
                const project = await M.getProject(b.projectId);
                return exportOneEpisode(project, await M.listCharacters(b.projectId), e, signal, onProgress);
            },
            onProgress: (eid, p) => {
                job.eid = eid;
                trackProgress(job, p);
                const fill = $('#d-bfill'), txt = $('#d-btext');
                if (fill) fill.style.width = batchPercent(job, b) + '%';
                if (txt) txt.textContent = batchText(job, b, S.lastEpisodes || []);
            },
            onUpdate: () => { job.phase = 'prep'; refresh('batch', 'episodes').catch(fail); }
        });
        const ok = BT.doneCount(out), n = out.ids.length;
        if (ctrl.signal.aborted) toast('Rendu en lot arrêté : « Reprendre » repartira du dernier plan encodé', 'warn', 4500);
        else toast(ok === n ? 'Lot terminé : ' + plural(n, 'épisode') + ' exporté' + (n > 1 ? 's' : '') : ok + '/' + n + ' épisodes exportés, ' + (n - ok) + ' en échec', ok === n ? 'success' : 'warn', 4500);
        S.batchSel = null;
        S.batchSelTouched = false;
    } catch (err) { fail(err); }
    finally {
        job.running = false;
        await refresh('batch', 'episodes', 'export');
    }
}

async function shareOrDownload(blob, name, type) {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
    }
    download(file, name);
    toast('Fichier enregistré : ' + name);
}

// ─── Section Sauvegarde ───────────────────────────────────────────
async function buildBackup() {
    return {
        badge: '', badgeClass: '',
        html:
            '<p class="char-intro">La série est stockée sur ce téléphone. Exportez-la régulièrement en fichier pour la garder en sécurité ou la passer sur un autre appareil.</p>' +
            '<button type="button" class="api-save-btn" data-action="export-full">Exporter la série (avec les images)</button>' +
            '<div class="char-actions">' +
                '<button type="button" class="char-btn" data-action="export-light">Exporter sans les images (fichier léger)</button>' +
                '<button type="button" class="char-btn" data-action="import-project">Importer une sauvegarde</button>' +
                '<button type="button" class="char-btn" data-action="rename-project">Renommer la série</button>' +
                '<button type="button" class="char-btn danger" data-action="delete-project">Supprimer la série</button>' +
            '</div>'
    };
}

// ─── Rendu ────────────────────────────────────────────────────────
const BUILDERS = { style: buildStyle, chars: buildChars, episodes: buildEpisodes, script: buildScript, images: buildImages, voices: buildVoices, clips: buildClips, montage: buildMontage, export: buildExport, batch: buildBatch, backup: buildBackup };

function setBadge(k, { badge, badgeClass }) {
    const b = $('#d-badge-' + k);
    if (!b) return;
    b.textContent = badge || '';
    b.className = 'badge' + (badgeClass ? ' ' + badgeClass : '') + (badge ? '' : ' hidden');
}

let renderSeq = 0;
async function renderAll() {
    const seq = ++renderSeq;
    await flushScript();
    const ctx = await loadCtx();
    let html = buildTop(ctx);
    const parts = {};
    if (ctx.project) {
        for (const [k] of SECTIONS) parts[k] = await BUILDERS[k](ctx);
        html += SECTIONS.map(([k, title]) =>
            '<div class="section d-section' + (isOpen(k, ctx) ? ' open' : '') + '" id="d-sec-' + k + '">' +
                '<div class="section-header" data-dtoggle="' + k + '"><span class="section-title">' + title +
                    ' <span class="badge" id="d-badge-' + k + '"></span></span><span class="chevron">▼</span></div>' +
                '<div class="section-body"><div class="section-content" id="d-body-' + k + '">' + parts[k].html + '</div></div>' +
            '</div>').join('');
    }
    if (seq !== renderSeq) return;
    root.innerHTML = html;
    for (const k in parts) setBadge(k, parts[k]);
    if (ctx.episode) renderAnalysis(ctx.episode.analysis || parseScript(ctx.episode.script, ctx.chars));
    attachPreview();
    pruneAssetUrls();
    root.dataset.ready = '1';
}

// Met à jour seulement certaines sections (sans toucher au script en cours d'écriture).
async function refresh(...keys) {
    if (!$('#d-sec-style')) return renderAll();
    // l'animation dépend des images, des voix (durées) et du plan ; le montage de tout cela
    if (!keys.includes('clips') && keys.some(k => ['script', 'images', 'voices', 'chars', 'style', 'episodes'].includes(k))) keys.push('clips');
    if (!keys.includes('montage') && keys.some(k => ['script', 'images', 'voices', 'clips', 'chars', 'style', 'episodes'].includes(k))) keys.push('montage');
    if (!keys.includes('export') && keys.includes('montage')) keys.push('export');
    if (!keys.includes('batch') && keys.some(k => ['export', 'episodes'].includes(k))) keys.push('batch');
    const ctx = await loadCtx();
    if (!ctx.project) return renderAll();
    for (const k of keys) {
        const body = $('#d-body-' + k);
        if (!body) continue;
        const part = await BUILDERS[k](ctx);
        body.innerHTML = part.html;
        setBadge(k, part);
        if (k === 'script' && ctx.episode) renderAnalysis(ctx.episode.analysis || parseScript(ctx.episode.script, ctx.chars));
        if (k === 'montage') attachPreview();
    }
    pruneAssetUrls();
}

// ─── Actions ──────────────────────────────────────────────────────
async function selectProject(pid) {
    await flushScript();
    await discardCharImage();
    S.pid = pid; S.eid = null; S.newSeries = false;
    resetCharForm();
    lsSet(CUR_PROJECT, pid);
    await renderAll();
}

const actions = {
    async 'goto-videos'() { location.hash = '#videos'; },
    async 'cancel-new'() { S.newSeries = false; await renderAll(); },
    async 'create-project'() {
        const p = await M.createProject({ name: $('#d-new-name').value, styleText: $('#d-new-style').value });
        toast('Série « ' + p.name + ' » créée');
        setOpen('style', true); setOpen('chars', true);
        await selectProject(p.id);
    },
    async 'import-project'() {
        const file = await pickFile('application/json,.json');
        if (!file) { await renderAll(); return; }
        let data;
        try { data = JSON.parse(await file.text()); } catch (e) { await renderAll(); throw new M.DramaError('Fichier illisible'); }
        const p = await M.importProject(data);
        toast('Série « ' + p.name + ' » importée');
        await selectProject(p.id);
    },
    async 'eleven-edit'() {
        S.elevenForm = !S.elevenForm;
        root.querySelector('.d-eleven-form').classList.toggle('hidden', !S.elevenForm);
    },
    async 'save-eleven'() {
        EL.setKey($('#d-eleven-key').value);
        S.voices = null;
        toast(EL.getKey() ? 'Clé ElevenLabs enregistrée' : 'Clé supprimée', EL.getKey() ? 'success' : 'warn');
        S.elevenForm = !!EL.getKey();
        await renderAll();
    },
    async 'test-eleven'() {
        const st = $('#d-eleven-status');
        st.textContent = 'Vérification…';
        try {
            S.voices = await EL.listVoices({ force: true });
            st.textContent = '✅ ' + S.voices.length + ' voix disponibles. Essai de synthèse…';
        } catch (e) { st.textContent = '⚠️ ' + e.message; return; }
        // essai de synthèse sur un mot (quelques caractères de crédit) : vérifie les droits de la clé
        const chars = await M.listCharacters(S.pid || '').catch(() => []);
        const vid = (chars.find(c => c.voice && c.voice.voiceId) || {}).voice?.voiceId || (S.voices[0] && S.voices[0].voiceId);
        if (!vid) { st.textContent = '✅ Clé valide : ' + S.voices.length + ' voix disponibles.'; return; }
        try {
            await EL.synthesize({ voiceId: vid, text: 'Bonjour.', modelId: M.ELEVEN_MODELS[0].id, settings: M.DEFAULT_VOICE });
            st.textContent = '✅ Clé valide : ' + S.voices.length + ' voix disponibles, synthèse vocale autorisée.';
        } catch (e) { st.textContent = '⚠️ La liste des voix fonctionne, mais pas la synthèse : ' + e.message; }
    },
    async 'save-style'() {
        await M.updateProject(S.pid, { style: { text: $('#d-style-text').value, negative: $('#d-style-neg').value } });
        toast('Style enregistré');
        await refresh('style', 'images', 'episodes');
    },
    async 'toggle-lock'() {
        const p = await M.getProject(S.pid);
        if (p.style.locked) {
            if (!confirm('Déverrouiller le style ? Les images déjà générées ne suivront plus forcément le nouveau style.')) return;
            await M.setStyleLocked(p.id, false);
            toast('Style déverrouillé', 'warn');
        } else {
            await M.updateProject(p.id, { style: { text: $('#d-style-text').value, negative: $('#d-style-neg').value } });
            await M.setStyleLocked(p.id, true);
            toast('Style verrouillé 🔒');
        }
        await refresh('style', 'images', 'episodes');
    },
    async 'pick-style-image'() {
        const file = await pickFile('image/*');
        if (!file) return;
        const asset = await M.saveImageAsset(S.pid, file, 'style');
        try { await M.updateProject(S.pid, { style: { refImageId: asset.id } }); }
        catch (e) { await M.deleteAsset(asset.id); throw e; }
        toast('Image de référence du style enregistrée');
        await refresh('style', 'images', 'episodes');
    },
    async 'remove-style-image'() {
        await M.updateProject(S.pid, { style: { refImageId: null } });
        await refresh('style', 'images', 'episodes');
    },
    async 'edit-char'(el) {
        await discardCharImage();
        S.charDraft = null;
        S.editingCharId = el.dataset.id;
        await refresh('chars');
        $('#d-char-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async 'cancel-char'() { await discardCharImage(); resetCharForm(); await refresh('chars'); },
    async 'delete-char'(el) {
        const c = (await M.listCharacters(S.pid)).find(x => x.id === el.dataset.id);
        if (!c || !confirm('Supprimer la fiche @' + c.name + ' ?')) return;
        await M.deleteCharacter(c.id);
        if (S.editingCharId === c.id) { await discardCharImage(); resetCharForm(); }
        toast('Fiche @' + c.name + ' supprimée', 'warn');
        await refresh('chars', 'episodes', 'script', 'images', 'voices');
    },
    async 'pick-char-image'() {
        const file = await pickFile('image/*');
        if (!file) return;
        S.charDraft = readCharForm();
        await discardCharImage();
        S.charImageId = (await M.saveImageAsset(S.pid, file, 'character')).id;
        await refresh('chars');
    },
    async 'remove-char-image'() {
        S.charDraft = readCharForm();
        await discardCharImage();
        S.charImageId = null;
        await refresh('chars');
    },
    async 'load-voices'() {
        S.charDraft = readCharForm();
        S.voices = await EL.listVoices({ force: true });
        toast(S.voices.length + ' voix chargées');
        await refresh('chars');
    },
    async 'preview-voice'() {
        const sel = $('#d-char-voice-select');
        const id = sel ? sel.value : $('#d-char-voice-id').value.trim();
        if (!id) { toast('Choisissez d\'abord une voix', 'warn'); return; }
        if (!S.voices) S.voices = await EL.listVoices();
        const v = S.voices.find(x => x.voiceId === id);
        if (!v || !v.previewUrl) { toast('Pas d\'extrait pour cette voix', 'warn'); return; }
        if (S.previewAudio) S.previewAudio.pause();
        S.previewAudio = new Audio(v.previewUrl);
        await S.previewAudio.play();
    },
    async 'save-char'() {
        const data = readCharForm();
        if (S.editingCharId) data.id = S.editingCharId;
        if (S.charImageId !== undefined) data.refImageId = S.charImageId;
        const c = await M.saveCharacter(S.pid, data);
        const wasEditing = !!S.editingCharId;
        S.charImageId = undefined;
        resetCharForm();
        toast(wasEditing ? 'Fiche @' + c.name + ' mise à jour' : 'Fiche @' + c.name + ' créée');
        await refresh('chars', 'episodes', 'script', 'images', 'voices');
    },
    async 'select-episode'(el) {
        await flushScript();
        S.eid = el.dataset.eid;
        lsSet(CUR_EPISODE + S.pid, S.eid);
        await refresh('episodes', 'script', 'images', 'voices');
        openSection('script');
        $('#d-sec-script').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async 'new-episode'() {
        await flushScript();
        const e = await M.createEpisode(S.pid);
        S.eid = e.id;
        lsSet(CUR_EPISODE + S.pid, e.id);
        await refresh('episodes', 'script', 'images', 'voices');
        openSection('script');
        $('#d-sec-script').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async 'delete-episode'() {
        if (!confirm('Supprimer cet épisode, son script et ses images ?')) return;
        if (S.job && S.job.running && S.job.eid === S.eid) S.job.ctrl.abort();
        if (S.cjob && S.cjob.running && S.cjob.eid === S.eid) S.cjob.ctrl.abort();
        if (S.xjob && S.xjob.running && S.xjob.eid === S.eid) S.xjob.ctrl.abort();
        S.pendingScript = null;
        const gone = (await M.listEpisodes(S.pid)).find(x => x.id === S.eid);
        if (gone && gone.exportInfo) await EX.deleteExportFile(gone.exportInfo.file);
        await EX.deleteEpisodeRenders(S.eid);
        await M.deleteEpisode(S.eid);
        S.eid = null;
        toast('Épisode supprimé', 'warn');
        await refresh('episodes', 'script', 'images', 'voices');
    },
    async 'insert-tag'(el) { insertAtCursor($('#d-script'), el.dataset.tag + ' '); },
    async 'insert-template'() {
        const ta = $('#d-script');
        const n = (ta.value.match(/^\s*\[PLAN\]/gim) || []).length + 1;
        const prefix = ta.value && !ta.value.endsWith('\n') ? '\n\n' : (ta.value ? '\n' : '');
        ta.setSelectionRange(ta.value.length, ta.value.length);
        insertAtCursor(ta, prefix + PLAN_TEMPLATE.replace('[PLAN] 1', '[PLAN] ' + n));
    },
    async 'goto-line'(el) { gotoLine(parseInt(el.dataset.line, 10)); },
    async 'copy-json'() {
        await navigator.clipboard.writeText(JSON.stringify(S.lastAnalysis.plans, null, 2));
        toast('JSON copié');
    },
    async 'download-json'() {
        const e = (await M.listEpisodes(S.pid)).find(x => x.id === S.eid);
        download(new Blob([JSON.stringify({ episode: e.number, title: e.title, ...S.lastAnalysis }, null, 2)], { type: 'application/json' }),
            'ep' + e.number + '-plans.json');
    },
    async 'gen-images'() { await startImages(null, false); },
    async 'gen-clips'() { await startClips(null, false); },
    async 'regen-clip'(el) {
        const c = await CL.getClip(S.eid, el.dataset.plan);
        await startClips([el.dataset.plan], !!(c && c.current));
    },
    async 'stop-clips'() {
        if (!S.cjob) return;
        S.cjob.ctrl.abort();
        S.cjob.line = 'Arrêt…';
        const ln = $('#d-cjob-line');
        if (ln) ln.textContent = 'Arrêt…';
    },
    async 'import-clip'(el) {
        const file = await pickFile('video/*');
        if (!file) return;
        const ctx = await loadCtx();
        await CL.importClipFile(ctx.project, ctx.chars, ctx.episode, el.dataset.plan, file);
        toast('Clip de ' + el.dataset.plan + ' importé');
        await refresh('clips', 'voices', 'episodes');
    },
    async 'clip-version'(el) {
        const c = await CL.getClip(S.eid, el.dataset.plan);
        if (!c) return;
        const i = c.versions.indexOf(c.current) + parseInt(el.dataset.dir, 10);
        if (i < 0 || i >= c.versions.length) return;
        await CL.selectClipVersion(S.eid, el.dataset.plan, c.versions[i]);
        await refresh('clips', 'voices', 'episodes');
    },
    async 'gen-voices'() { await startVoices(null, false); },
    async 'regen-line'(el) {
        const t = await VO.getTake(S.eid, el.dataset.line);
        await startVoices([el.dataset.line], !!(t && t.current));
    },
    async 'stop-voices'() {
        if (!S.vjob) return;
        S.vjob.ctrl.abort();
        S.vjob.line = 'Arrêt…';
        const ln = $('#d-vjob-line');
        if (ln) ln.textContent = 'Arrêt…';
    },
    async 'take-version'(el) {
        const t = await VO.getTake(S.eid, el.dataset.line);
        if (!t) return;
        const i = t.versions.indexOf(t.current) + parseInt(el.dataset.dir, 10);
        if (i < 0 || i >= t.versions.length) return;
        await VO.selectTakeVersion(S.eid, el.dataset.line, t.versions[i]);
        await refresh('voices', 'episodes');
    },
    async 'play-line'(el) {
        const t = await VO.getTake(S.eid, el.dataset.line);
        const a = t && await M.getAsset(t.current);
        if (!a) return;
        stopPlayback();
        const url = URL.createObjectURL(a.blob);
        const audio = new Audio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        S.player = { audio };
        await audio.play();
    },
    async 'play-episode'() { await playEpisode(); },
    async 'rec-start'(el) {
        if (S.rec) return;
        stopPlayback();
        if (S.preview) S.preview.pause();
        const session = await MIC.startRecording();
        S.rec = { lineId: el.dataset.line, eid: S.eid, session, timer: null };
        S.rec.timer = setInterval(() => {
            if (!S.rec) return;
            const sec = (Date.now() - S.rec.session.startedAt) / 1000;
            const t = $('#d-rec-time');
            if (t) t.textContent = fmtClock(sec);
            if (sec >= MIC.MAX_SECONDS) actions['rec-stop']().catch(fail);
        }, 250);
        await refresh('voices');
    },
    async 'rec-stop'() {
        const r = S.rec;
        if (!r) return;
        S.rec = null;
        clearInterval(r.timer);
        try {
            const raw = await r.session.stop();
            const out = await MIC.processRecording(raw);
            const ctx = await loadCtx();
            const e = ctx.episodes.find(x => x.id === r.eid);
            await VO.saveMicTake(ctx.project, e, r.lineId, out.blob, out.duration);
            toast('Réplique enregistrée : ' + out.duration.toFixed(1) + ' s' + (out.trimmed > 0.2 ? ' (silences retirés)' : ''));
        } finally {
            await refresh('voices', 'episodes');
        }
    },
    async 'rec-cancel'() { cancelRecording(); await refresh('voices'); },
    async 'stop-play'() { stopPlayback(); await refresh('voices'); },
    async 'start-export'() { await startExport(); },
    async 'batch-start'() {
        const ctx = await loadCtx();
        const ids = ctx.episodes.filter(e => S.batchSel && S.batchSel.has(e.id)).map(e => e.id);   // dans l'ordre des épisodes
        if (!ids.length) return;
        await runBatchUI(BT.newBatch(ctx.project.id, ids));
    },
    async 'batch-resume'() {
        const b = BT.loadBatch();
        if (b) await runBatchUI(b);
    },
    async 'batch-forget'() { BT.saveBatch(null); await refresh('batch'); },
    async 'batch-stop'() {
        if (!S.bjob) return;
        S.bjob.ctrl.abort();
        const t = $('#d-btext');
        if (t) t.textContent = 'Arrêt…';
    },
    async 'stop-export'() {
        if (!S.xjob) return;
        S.xjob.ctrl.abort();
        const txt = $('#d-xtext');
        if (txt) txt.textContent = 'Arrêt…';
    },
    async 'save-export'() {
        const ctx = await loadCtx();
        const info = ctx.episode && ctx.episode.exportInfo;
        const file = info && await EX.getExportFile(info.file);
        if (!file) { toast('Fichier introuvable : exportez à nouveau', 'warn'); return; }
        await shareOrDownload(file, seriesSlug(ctx.project.name) + '-ep' + ctx.episode.number + '.mp4', 'video/mp4');
    },
    async 'delete-export'() {
        if (!confirm('Supprimer le MP4 exporté de cet épisode ? (le montage reste intact)')) return;
        const ctx = await loadCtx();
        if (ctx.episode.exportInfo) await EX.deleteExportFile(ctx.episode.exportInfo.file);
        await M.updateEpisode(ctx.episode.id, { exportInfo: null });
        if (S.exportUrl) { URL.revokeObjectURL(S.exportUrl.url); S.exportUrl = null; }
        await refresh('export', 'episodes');
    },
    async 'make-thumb'() {
        const ctx = await loadCtx();
        const e = ctx.episode;
        const tl = await PL.loadEpisodeTimeline(ctx.project, ctx.chars, e);
        const { blob, planId } = await EX.renderThumbnail(tl, $('#d-thumb-plan').value, { series: ctx.project.name, episode: e.number, title: e.title });
        const asset = await M.saveThumbAsset(ctx.project.id, e.id, blob, planId);
        await M.updateEpisode(e.id, { thumb: { assetId: asset.id, planId } });
        toast('Vignette EP.' + e.number + ' créée');
        await refresh('export');
    },
    async 'save-thumb'() {
        const ctx = await loadCtx();
        const a = ctx.episode.thumb && await M.getAsset(ctx.episode.thumb.assetId);
        if (a) await shareOrDownload(a.blob, seriesSlug(ctx.project.name) + '-ep' + ctx.episode.number + '-vignette.jpg', 'image/jpeg');
    },
    async 'preview-play'() {
        if (!S.preview) return;
        if (S.preview.playing) S.preview.pause();
        else { stopPlayback(); await S.preview.play(); }
    },
    async 'lib-import'(el) {
        const file = await pickFile('audio/*');
        if (!file) return;
        let duration;
        try { duration = await PL.audioFileDuration(file); } catch (e) { throw new M.DramaError('Fichier audio illisible'); }
        await M.saveLibrarySound(S.pid, el.dataset.kind, el.dataset.name, file, duration, el.dataset.label);
        toast((el.dataset.kind === 'music' ? 'Musique' : 'Bruitage') + ' « ' + el.dataset.label + ' » importé');
        await refresh('montage');
    },
    async 'lib-play'(el) {
        const a = await M.getAsset(el.dataset.asset);
        if (!a) return;
        stopPlayback();
        if (S.preview) S.preview.pause();
        const url = URL.createObjectURL(a.blob);
        const audio = new Audio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        S.player = { audio };
        await audio.play();
    },
    async 'lib-delete'(el) {
        if (!confirm('Retirer ce son de la série ?')) return;
        await M.deleteAsset(el.dataset.asset);
        await refresh('montage');
    },
    async 'open-eleven'() {
        S.elevenForm = true;
        const f = root.querySelector('.d-eleven-form');
        if (f) f.classList.remove('hidden');
        $('#d-top').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async 'regen-plan'(el) {
        const sh = await IMG.getShot(S.eid, el.dataset.plan);
        await startImages([el.dataset.plan], !!(sh && sh.current));
    },
    async 'stop-images'() {
        if (!S.job) return;
        S.job.ctrl.abort();
        S.job.line = 'Arrêt…';
        const ln = $('#d-job-line');
        if (ln) ln.textContent = 'Arrêt…';
    },
    async 'shot-version'(el) {
        const sh = await IMG.getShot(S.eid, el.dataset.plan);
        if (!sh) return;
        const i = sh.versions.indexOf(sh.current) + parseInt(el.dataset.dir, 10);
        if (i < 0 || i >= sh.versions.length) return;
        await IMG.selectShotVersion(S.eid, el.dataset.plan, sh.versions[i]);
        await refresh('images', 'episodes');
    },
    async 'zoom-shot'(el) { showZoom(el.src); },
    async 'zoom-clip'(el) {
        if (S.preview) S.preview.pause();
        stopPlayback();
        const ov = document.createElement('div');
        ov.className = 'd-overlay';
        ov.innerHTML = '<video src="' + el.src + '" controls autoplay playsinline></video>';
        ov.addEventListener('click', ev => { if (ev.target === ov) { ov.querySelector('video').pause(); ov.remove(); } });
        document.body.appendChild(ov);
    },
    async 'export-full'() { await exportSeries(true); },
    async 'export-light'() { await exportSeries(false); },
    async 'rename-project'() {
        const p = await M.getProject(S.pid);
        const name = prompt('Nouveau titre de la série', p.name);
        if (name == null) return;
        await M.updateProject(p.id, { name });
        await renderAll();
    },
    async 'delete-project'() {
        const p = await M.getProject(S.pid);
        if (!confirm('Supprimer définitivement « ' + p.name + ' », ses personnages, ses épisodes et ses images ?')) return;
        if (S.job && S.job.running && S.job.pid === p.id) S.job.ctrl.abort();
        if (S.cjob && S.cjob.running && S.cjob.pid === p.id) S.cjob.ctrl.abort();
        if (S.xjob && S.xjob.running) S.xjob.ctrl.abort();
        if (S.bjob && S.bjob.running) S.bjob.ctrl.abort();
        for (const ep of await M.listEpisodes(p.id)) {
            if (ep.exportInfo) await EX.deleteExportFile(ep.exportInfo.file);
            await EX.deleteEpisodeRenders(ep.id);
        }
        const b = BT.loadBatch();
        if (b && b.projectId === p.id) BT.saveBatch(null);
        await M.deleteProject(p.id);
        S.pid = null; S.eid = null;
        toast('Série supprimée', 'warn');
        await renderAll();
    }
};

async function exportSeries(includeImages) {
    const data = await M.exportProject(S.pid, { includeImages });
    const slug = M.normalizeName(data.project.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'serie';
    const name = 'drama-' + slug + (includeImages ? '' : '-sans-images') + '-' + new Date().toISOString().slice(0, 10) + '.json';
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: data.project.name }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
    }
    download(blob, name);
    toast('Sauvegarde téléchargée');
}

// ─── Écouteurs ────────────────────────────────────────────────────
root.addEventListener('click', async ev => {
    const tog = ev.target.closest('[data-dtoggle]');
    if (tog && root.contains(tog)) {
        const sec = tog.parentElement;
        sec.classList.toggle('open');
        setOpen(tog.dataset.dtoggle, sec.classList.contains('open'));
        return;
    }
    const el = ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = actions[el.dataset.action];
    if (!fn || el.disabled) return;
    if (el.tagName === 'BUTTON') el.disabled = true;
    try { await fn(el); } catch (e) { fail(e); }
    finally { if (el.isConnected && el.tagName === 'BUTTON') el.disabled = false; }
});

root.addEventListener('input', ev => {
    const t = ev.target;
    if (t.id === 'd-seek' && S.preview) { S.preview.seek(parseFloat(t.value)); return; }
    if (t.id === 'd-music-vol' || t.id === 'd-duck') { const o = $('#' + t.id + '-val'); if (o) o.textContent = Math.round(t.value * 100) + ' %'; return; }
    if (t.id === 'd-script') scheduleScriptSave();
    else if (t.type === 'range') { const out = $('#' + t.id + '-val'); if (out) out.textContent = t.value; }
    else if (t.id === 'd-eleven-key') { const b = root.querySelector('[data-action="test-eleven"]'); if (b) b.disabled = true; }
});

root.addEventListener('change', async ev => {
    const t = ev.target;
    try {
        if (t.dataset && t.dataset.bsel) {
            if (!S.batchSel) S.batchSel = new Set();
            if (t.checked) S.batchSel.add(t.dataset.bsel); else S.batchSel.delete(t.dataset.bsel);
            S.batchSelTouched = true;
            await refresh('batch');
            return;
        }
        if (t.dataset && (t.dataset.clipAnimate || t.dataset.clipAudio)) {
            const planId = t.dataset.clipAnimate || t.dataset.clipAudio;
            await CL.saveClipPrefs(S.pid, S.eid, planId, t.dataset.clipAnimate ? { animate: t.checked } : { audio: t.value });
            if (t.dataset.clipAudio) toast(t.value === 'agnes' ? planId + ' : voix d\'Agnes (durée du clip)' : planId + ' : votre voix');
            await refresh('clips', 'voices', 'episodes');
            return;
        }
        if (t.id === 'd-series') {
            if (t.value === '__new') { S.newSeries = true; await renderAll(); $('#d-new-name').focus(); }
            else if (t.value === '__import') { await actions['import-project'](); }
            else await selectProject(t.value);
        } else if (t.id === 'd-voice-model') {
            await M.updateProject(S.pid, { voiceModel: t.value });
            toast('Modèle de voix enregistré');
            await refresh('episodes', 'voices');
        } else if (t.id === 'd-ep-title') {
            await M.updateEpisode(S.eid, { title: t.value });
            await refresh('episodes');
        } else if (t.id === 'd-ep-number') {
            try { await M.updateEpisode(S.eid, { number: t.value }); }
            catch (err) {
                fail(err);
                const cur = (await M.listEpisodes(S.pid)).find(x => x.id === S.eid);
                t.value = cur.number;
                return;
            }
            await refresh('episodes', 'images', 'voices');
            setBadge('script', scriptBadge((await M.listEpisodes(S.pid)).find(x => x.id === S.eid)));
        } else if (['d-sub-on', 'd-sub-size', 'd-music-vol', 'd-duck'].includes(t.id)) {
            await M.updateProject(S.pid, { montage: {
                subtitles: $('#d-sub-on').value === '1', subSize: $('#d-sub-size').value,
                musicVolume: parseFloat($('#d-music-vol').value), duck: parseFloat($('#d-duck').value)
            }});
            await refresh('montage');
        } else if (t.id === 'd-img-model' || t.id === 'd-img-size' || t.id === 'd-img-refs') {
            await M.updateProject(S.pid, { imageSettings: {
                model: $('#d-img-model').value, size: $('#d-img-size').value, refs: $('#d-img-refs').value
            }});
            await refresh('images', 'episodes');
        }
    } catch (e) { fail(e); }
});

root.addEventListener('focusout', ev => { if (ev.target.id === 'd-script') flushScript(); });

// Retour sur l'onglet Drama : la clé Agnes a pu changer dans l'onglet Vidéos.
window.addEventListener('atelier:tab', ev => {
    if (ev.detail !== 'drama') { stopPlayback(); cancelRecording(); if (S.preview) S.preview.pause(); return; }
    if ([S.job, S.vjob, S.cjob, S.xjob, S.bjob].some(j => j && j.running)) return;
    if ($('#d-char-name')) { try { S.charDraft = readCharForm(); } catch (e) {} }   // fiche en cours de saisie gardée
    renderAll().catch(fail);
});

renderAll().catch(fail);
