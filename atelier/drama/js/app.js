// Drama — onglet « 🎬 Drama » de l'appli Atelier Vidéo.
// Même présentation que l'onglet Vidéos : un panneau en haut (série en cours, clés),
// puis des sections repliables : Style, Personnages, Épisodes, Script, Images, Sauvegarde.
import * as M from './model.js';
import * as EL from './elevenlabs.js';
import * as IMG from './images.js';
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
    ['backup', '💾 Sauvegarde et gestion']
];

const S = {
    pid: null, eid: null,
    newSeries: false, elevenForm: false,
    voices: null, previewAudio: null,
    editingCharId: null, charImageId: undefined, charDraft: null,
    scriptTimer: null, pendingScript: null, lastAnalysis: null,
    imagesTimer: null,
    job: null            // génération d'images en cours : { pid, eid, ctrl, states: Map, line, running }
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
    const used = new Set([...root.querySelectorAll('img[data-asset]')].map(i => i.dataset.asset));
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
    return k === 'episodes' || k === 'script' || k === 'images';
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
        return '<div class="d-ep' + (e.id === S.eid ? ' current' : '') + '" data-action="select-episode" data-eid="' + e.id + '">' +
            '<div class="d-ep-num">EP.' + e.number + '</div>' +
            '<div class="d-ep-main"><div class="d-ep-title">' + esc(e.title) + '</div>' +
            '<div class="d-ep-sub">' + plural(n, 'plan') + ' · ' + state + (imgs ? ' · 🖼️ ' + imgs.ready + '/' + imgs.total : '') + '</div></div>' +
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
            S.imagesTimer = setTimeout(() => refresh('episodes', 'images').catch(fail), 900);
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
const BUILDERS = { style: buildStyle, chars: buildChars, episodes: buildEpisodes, script: buildScript, images: buildImages, backup: buildBackup };

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
    pruneAssetUrls();
    root.dataset.ready = '1';
}

// Met à jour seulement certaines sections (sans toucher au script en cours d'écriture).
async function refresh(...keys) {
    if (!$('#d-sec-style')) return renderAll();
    const ctx = await loadCtx();
    if (!ctx.project) return renderAll();
    for (const k of keys) {
        const body = $('#d-body-' + k);
        if (!body) continue;
        const part = await BUILDERS[k](ctx);
        body.innerHTML = part.html;
        setBadge(k, part);
        if (k === 'script' && ctx.episode) renderAnalysis(ctx.episode.analysis || parseScript(ctx.episode.script, ctx.chars));
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
            st.textContent = '✅ Clé valide : ' + S.voices.length + ' voix disponibles.';
        } catch (e) { st.textContent = '⚠️ ' + e.message; }
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
        await refresh('chars', 'episodes', 'script', 'images');
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
        await refresh('chars', 'episodes', 'script', 'images');
    },
    async 'select-episode'(el) {
        await flushScript();
        S.eid = el.dataset.eid;
        lsSet(CUR_EPISODE + S.pid, S.eid);
        await refresh('episodes', 'script', 'images');
        openSection('script');
        $('#d-sec-script').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async 'new-episode'() {
        await flushScript();
        const e = await M.createEpisode(S.pid);
        S.eid = e.id;
        lsSet(CUR_EPISODE + S.pid, e.id);
        await refresh('episodes', 'script', 'images');
        openSection('script');
        $('#d-sec-script').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async 'delete-episode'() {
        if (!confirm('Supprimer cet épisode, son script et ses images ?')) return;
        if (S.job && S.job.running && S.job.eid === S.eid) S.job.ctrl.abort();
        S.pendingScript = null;
        await M.deleteEpisode(S.eid);
        S.eid = null;
        toast('Épisode supprimé', 'warn');
        await refresh('episodes', 'script', 'images');
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
    if (t.id === 'd-script') scheduleScriptSave();
    else if (t.type === 'range') { const out = $('#' + t.id + '-val'); if (out) out.textContent = t.value; }
    else if (t.id === 'd-eleven-key') { const b = root.querySelector('[data-action="test-eleven"]'); if (b) b.disabled = true; }
});

root.addEventListener('change', async ev => {
    const t = ev.target;
    try {
        if (t.id === 'd-series') {
            if (t.value === '__new') { S.newSeries = true; await renderAll(); $('#d-new-name').focus(); }
            else if (t.value === '__import') { await actions['import-project'](); }
            else await selectProject(t.value);
        } else if (t.id === 'd-voice-model') {
            await M.updateProject(S.pid, { voiceModel: t.value });
            toast('Modèle de voix enregistré');
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
            await refresh('episodes', 'images');
            setBadge('script', scriptBadge((await M.listEpisodes(S.pid)).find(x => x.id === S.eid)));
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
    if (ev.detail !== 'drama' || (S.job && S.job.running)) return;
    if ($('#d-char-name')) { try { S.charDraft = readCharForm(); } catch (e) {} }   // fiche en cours de saisie gardée
    renderAll().catch(fail);
});

renderAll().catch(fail);
