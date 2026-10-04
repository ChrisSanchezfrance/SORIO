// Drama — interface (étape 1 : projets série, style verrouillé, personnages, épisodes)
import * as M from './model.js';
import * as EL from './elevenlabs.js';
import { parseScript } from './parser.js';

const view = document.getElementById('view');
let objectUrls = [];
let voices = null;          // voix ElevenLabs chargées (ou null)
let previewAudio = null;
let scriptSaveTimer = null;
let pendingScriptSave = null;
const openSections = {};    // sections ouvertes/fermées par l'utilisateur, par série

// ─── Utilitaires ──────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = t => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const $ = sel => view.querySelector(sel);
function fmtDuration(sec) {
    const s = Math.round(sec);
    return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0');
}

let toastTimer = null;
function toast(msg, type = 'success', ms = 2500) {
    const el = document.getElementById('toast');
    el.classList.remove('visible', 'success', 'error', 'warn');
    void el.offsetWidth;
    document.getElementById('toast-icon').textContent = { success: '✓', error: '✕', warn: '⚠' }[type] || '✓';
    document.getElementById('toast-text').textContent = msg;
    el.classList.add(type);
    requestAnimationFrame(() => el.classList.add('visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
}
const fail = e => { console.error(e); toast(e && e.message ? e.message : String(e), 'error', 3500); };

function blobUrl(blob) {
    const u = URL.createObjectURL(blob);
    objectUrls.push(u);
    return u;
}
async function assetUrl(id) {
    const a = await M.getAsset(id);
    return a ? blobUrl(a.blob) : '';
}

function pickFile(inputId) {
    const input = document.getElementById(inputId);
    return new Promise(resolve => {
        input.value = '';
        input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
        input.oncancel = () => resolve(null);
        input.click();
    });
}

function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }

// ─── Routeur ──────────────────────────────────────────────────────
async function render() {
    await flushScriptSave();
    objectUrls.forEach(u => URL.revokeObjectURL(u));
    objectUrls = [];
    if (previewAudio) { previewAudio.pause(); previewAudio = null; }
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    try {
        if (parts[0] === 'p' && parts[1] && parts[2] === 'e' && parts[3]) await renderEpisode(parts[1], parts[3]);
        else if (parts[0] === 'p' && parts[1]) await renderProject(parts[1]);
        else await renderHome();
    } catch (e) {
        fail(e);
        view.innerHTML = '<div class="panel">Une erreur est survenue. <a href="#/">Retour aux séries</a></div>';
    }
    window.scrollTo(0, 0);
}
window.addEventListener('hashchange', async () => {
    // quitter l'écran abandonne le formulaire personnage en cours
    await discardCharFormImage().catch(() => {});
    editingCharId = null;
    render();
});

// ─── Accueil : clé ElevenLabs + liste des séries ──────────────────
async function renderHome() {
    const projects = await M.listProjects();
    const rows = await Promise.all(projects.map(async p => {
        const [chars, eps] = await Promise.all([M.listCharacters(p.id), M.listEpisodes(p.id)]);
        const thumb = p.style.refImageId ? await assetUrl(p.style.refImageId) : '';
        return '<div class="card" data-go="#/p/' + p.id + '">' +
            (thumb ? '<img class="thumb tall" src="' + thumb + '" alt="">' : '<div class="thumb tall">🎬</div>') +
            '<div class="card-main"><div class="card-title">' + esc(p.name) +
            (p.style.locked ? '<span class="badge ok">🔒 style</span>' : '') + '</div>' +
            '<div class="card-sub">' + eps.length + ' épisode' + (eps.length > 1 ? 's' : '') + ' · ' +
            chars.length + ' personnage' + (chars.length > 1 ? 's' : '') + '</div>' +
            '<div class="card-sub">Modifié le ' + fmtDate(p.updatedAt) + '</div></div></div>';
    }));
    const key = EL.getKey();
    view.innerHTML =
        '<div class="panel">' +
            '<label class="lbl" for="el-key">Clé ElevenLabs (voix)</label>' +
            '<input type="password" id="el-key" autocomplete="off" spellcheck="false" placeholder="Collez votre clé ElevenLabs" value="' + esc(key) + '">' +
            '<div class="btns" style="margin-top:0.5rem"><button class="btn small" data-action="save-key">Enregistrer la clé</button>' +
            '<button class="btn small light" data-action="test-key"' + (key ? '' : ' disabled') + '>Vérifier</button></div>' +
            '<div class="hint" id="key-status">' + (key ? 'Clé enregistrée sur ce téléphone.' : 'elevenlabs.io → Profile → API Keys. Elle reste sur ce téléphone.') + '</div>' +
        '</div>' +
        '<details class="section" open><summary><span class="section-title">🎬 Mes séries <span class="badge">' + projects.length + '</span></span></summary>' +
        '<div class="section-body">' +
            (rows.length ? rows.join('') : '<div class="empty">Aucune série pour l\'instant.</div>') +
            '<div class="form-box">' +
                '<div class="row"><label class="lbl" for="new-name">Nouvelle série</label>' +
                '<input type="text" id="new-name" maxlength="80" placeholder="Titre de la série"></div>' +
                '<div class="row"><label class="lbl" for="new-style">Style visuel (facultatif)</label>' +
                '<textarea id="new-style" placeholder="Ex. : manhwa dramatique, couleurs froides, lumière néon, traits fins, ombres marquées"></textarea></div>' +
                '<div class="btns"><button class="btn" data-action="create-project">Créer la série</button>' +
                '<button class="btn light" data-action="import-project">Importer une sauvegarde</button></div>' +
            '</div>' +
        '</div></details>';
}

// ─── Projet : style, personnages, épisodes, sauvegarde ────────────
let editingCharId = null;
let charFormImageId;       // undefined = inchangé ; null = retirée ; 'a…' = nouvelle

async function renderProject(pid) {
    const p = await M.getProject(pid);
    if (!p) { toast('Série introuvable', 'error'); go('#/'); return; }
    const [chars, eps] = await Promise.all([M.listCharacters(pid), M.refreshEpisodeAnalyses(pid)]);
    const styleRef = p.style.refImageId ? await assetUrl(p.style.refImageId) : '';
    const locked = p.style.locked;
    const dis = locked ? ' disabled' : '';

    const charCards = await Promise.all(chars.map(async c => {
        const t = c.refImageId ? await assetUrl(c.refImageId) : '';
        return '<div class="card static">' +
            (t ? '<img class="thumb" src="' + t + '" alt="">' : '<div class="thumb">' + esc(c.name[0].toUpperCase()) + '</div>') +
            '<div class="card-main"><div class="card-title">@' + esc(c.name) + '</div>' +
            '<div class="card-sub clamp2">' + (c.desc ? esc(c.desc) : '<em>Sans description</em>') + '</div>' +
            '<div class="card-sub">🎙️ ' + (c.voice.voiceId ? esc(c.voice.voiceName || c.voice.voiceId) : '<em>voix à choisir</em>') + '</div>' +
            '<div class="btns" style="margin-top:0.45rem">' +
                '<button class="btn small light" data-action="edit-char" data-id="' + c.id + '">Modifier</button>' +
                '<button class="btn small danger" data-action="delete-char" data-id="' + c.id + '">Supprimer</button>' +
            '</div></div></div>';
    }));

    const epCards = eps.map(e => {
        const a = e.analysis;
        const n = a ? a.stats.plans : 0;
        const state = !a || !e.script.trim() ? '📝 brouillon'
            : a.ok ? '✅ prêt · ~' + fmtDuration(a.stats.estimatedSeconds)
            : '❌ ' + a.errors.length + ' erreur' + (a.errors.length > 1 ? 's' : '');
        return '<div class="card" data-go="#/p/' + pid + '/e/' + e.id + '">' +
            '<div class="thumb">EP.' + e.number + '</div>' +
            '<div class="card-main"><div class="card-title">' + esc(e.title) + '</div>' +
            '<div class="card-sub">' + n + ' plan' + (n > 1 ? 's' : '') + ' · ' + state + '</div>' +
            '<div class="card-sub">' + fmtDate(e.updatedAt) + '</div></div></div>';
    });

    view.innerHTML =
        '<div class="panel"><a href="#/" class="back-link">← Mes séries</a>' +
            '<h2>' + esc(p.name) + '</h2>' +
            '<div class="card-sub">Format ' + p.format.width + '×' + p.format.height + ' · ' + p.format.fps + ' i/s · ' + p.format.ratio + '</div>' +
            '<div class="btns" style="margin-top:0.6rem"><button class="btn small light" data-action="rename-project">Renommer</button></div>' +
        '</div>' +

        '<details class="section" open data-sec="style"><summary><span class="section-title">🎨 Style de la série ' +
            (locked ? '<span class="badge ok">🔒 verrouillé</span>' : '<span class="badge soft">modifiable</span>') + '</span></summary>' +
        '<div class="section-body">' +
            '<div class="lock-banner' + (locked ? ' locked' : '') + '"><span>' +
                (locked ? '🔒 Verrouillé le ' + fmtDate(p.style.lockedAt) + ' : toutes les images de la série suivront ce style.'
                        : '🔓 Réglez le style, puis verrouillez-le avant de générer les images.') + '</span>' +
                '<button class="btn small ' + (locked ? 'light' : '') + '" data-action="toggle-lock">' + (locked ? 'Déverrouiller' : 'Verrouiller le style') + '</button></div>' +
            '<div class="row"><label class="lbl" for="style-text">Description du style</label>' +
                '<textarea id="style-text"' + dis + ' placeholder="Ex. : manhwa dramatique, couleurs froides, lumière néon, traits fins">' + esc(p.style.text) + '</textarea></div>' +
            '<div class="row"><label class="lbl" for="style-neg">À éviter</label>' +
                '<input type="text" id="style-neg"' + dis + ' value="' + esc(p.style.negative) + '" placeholder="Ex. : texte, filigrane, 3D, photo réaliste"></div>' +
            '<div class="row"><label class="lbl">Image de référence du style</label><div class="ref-row">' +
                (styleRef ? '<img class="ref-preview" src="' + styleRef + '" alt="Référence du style">' : '<div class="ref-preview"></div>') +
                '<div class="btns"><button class="btn small light" data-action="pick-style-image"' + dis + '>' + (styleRef ? 'Changer' : 'Choisir une image') + '</button>' +
                (styleRef ? '<button class="btn small danger" data-action="remove-style-image"' + dis + '>Retirer</button>' : '') + '</div></div></div>' +
            '<div class="row"><label class="lbl" for="style-seed">Graine (même graine = rendu plus constant)</label>' +
                '<div class="ref-row"><input type="number" id="style-seed" min="0" max="2147483647" style="flex:1" value="' + p.style.seed + '"' + dis + '>' +
                '<button class="btn small light" data-action="random-seed"' + dis + '>🎲</button></div></div>' +
            (locked ? '' : '<button class="btn block" data-action="save-style">Enregistrer le style</button>') +
        '</div></details>' +

        '<details class="section" ' + (chars.length ? '' : 'open ') + 'data-sec="chars"><summary><span class="section-title">👤 Personnages <span class="badge">' + chars.length + '</span></span></summary>' +
        '<div class="section-body">' +
            (charCards.length ? charCards.join('') : '<div class="empty">Aucun personnage. Créez le premier ci-dessous.</div>') +
            '<div class="row" style="margin-top:0.6rem"><label class="lbl" for="voice-model">Modèle de voix ElevenLabs (toute la série)</label>' +
                '<select id="voice-model">' + M.ELEVEN_MODELS.map(m => '<option value="' + m.id + '"' + (m.id === p.voiceModel ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></div>' +
            '<div class="form-box" id="char-form"></div>' +
        '</div></details>' +

        '<details class="section" open data-sec="eps"><summary><span class="section-title">📺 Épisodes <span class="badge">' + eps.length + '</span></span></summary>' +
        '<div class="section-body">' +
            (epCards.length ? epCards.join('') : '<div class="empty">Aucun épisode.</div>') +
            '<button class="btn block" data-action="new-episode">＋ Nouvel épisode</button>' +
        '</div></details>' +

        '<details class="section" data-sec="backup"><summary><span class="section-title">💾 Sauvegarde</span></summary>' +
        '<div class="section-body">' +
            '<div class="hint" style="margin:0 0 0.7rem">La série est stockée sur ce téléphone. Exportez-la régulièrement en fichier (personnages, images de référence et scripts compris) pour la garder en sécurité ou la passer sur un autre appareil.</div>' +
            '<div class="btns"><button class="btn light" data-action="export-project">Exporter la série</button>' +
            '<button class="btn danger" data-action="delete-project">Supprimer la série</button></div>' +
        '</div></details>';

    view.dataset.pid = pid;
    const remembered = openSections[pid] || {};
    view.querySelectorAll('details[data-sec]').forEach(d => {
        if (d.dataset.sec in remembered) d.open = remembered[d.dataset.sec];
    });
    await renderCharForm(pid, editingCharId ? chars.find(c => c.id === editingCharId) : null);
}

async function renderCharForm(pid, c) {
    const box = $('#char-form');
    if (!box) return;
    if (!c) editingCharId = null;
    const v = c ? c.voice : M.DEFAULT_VOICE;
    const imgId = charFormImageId !== undefined ? charFormImageId : (c ? c.refImageId : null);
    const img = imgId ? await assetUrl(imgId) : '';
    const voiceOptions = voices
        ? '<select id="char-voice-select"><option value="">— Choisir une voix —</option>' +
          voices.map(x => '<option value="' + esc(x.voiceId) + '"' + (x.voiceId === v.voiceId ? ' selected' : '') + '>' +
              esc(x.name) + (EL.describeVoice(x) ? ' — ' + esc(EL.describeVoice(x)) : '') + '</option>').join('') + '</select>'
        : '';
    const slider = (id, label, min, max, step, val) =>
        '<div><div class="slider-line"><span>' + label + '</span><span id="' + id + '-val">' + val + '</span></div>' +
        '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"></div>';

    box.innerHTML =
        '<div class="section-title" style="margin-bottom:0.7rem">' + (c ? 'Modifier @' + esc(c.name) : 'Nouveau personnage') + '</div>' +
        '<div class="row"><label class="lbl" for="char-name">Nom (un seul mot, appelé avec @Nom)</label>' +
            '<input type="text" id="char-name" maxlength="30" autocomplete="off" spellcheck="false" placeholder="Lina" value="' + esc(c ? c.name : '') + '"></div>' +
        '<div class="row"><label class="lbl" for="char-desc">Description fixe (apparence)</label>' +
            '<textarea id="char-desc" placeholder="Femme de 28 ans, cheveux noirs au carré, yeux verts, trench beige">' + esc(c ? c.desc : '') + '</textarea></div>' +
        '<div class="row"><label class="lbl">Image de référence</label><div class="ref-row">' +
            (img ? '<img class="ref-preview" src="' + img + '" alt="">' : '<div class="ref-preview"></div>') +
            '<div class="btns"><button class="btn small light" data-action="pick-char-image">' + (img ? 'Changer' : 'Choisir une photo') + '</button>' +
            (img ? '<button class="btn small danger" data-action="remove-char-image">Retirer</button>' : '') + '</div></div></div>' +
        '<div class="row"><label class="lbl">Voix</label>' + voiceOptions +
            '<input type="text" id="char-voice-id" placeholder="Identifiant de voix ElevenLabs" autocomplete="off" spellcheck="false" value="' + esc(v.voiceId) + '"' + (voices ? ' class="hidden"' : '') + '>' +
            '<input type="hidden" id="char-voice-name" value="' + esc(v.voiceName) + '">' +
            '<div class="btns" style="margin-top:0.5rem">' +
                '<button class="btn small light" data-action="load-voices">' + (voices ? '↻ Recharger mes voix' : 'Charger mes voix ElevenLabs') + '</button>' +
                '<button class="btn small light" data-action="preview-voice">▶ Écouter l\'extrait</button>' +
            '</div></div>' +
        '<div class="row grid2">' +
            slider('v-stability', 'Stabilité', 0, 1, 0.05, v.stability) +
            slider('v-similarity', 'Fidélité', 0, 1, 0.05, v.similarity) +
            slider('v-style', 'Expressivité', 0, 1, 0.05, v.style) +
            slider('v-speed', 'Vitesse', 0.7, 1.2, 0.05, v.speed) +
        '</div>' +
        '<div class="btns"><button class="btn" data-action="save-char">' + (c ? 'Mettre à jour @' + esc(c.name) : 'Enregistrer le personnage') + '</button>' +
        (c ? '<button class="btn light" data-action="cancel-char">Annuler</button>' : '') + '</div>';
}

function readCharForm() {
    const sel = $('#char-voice-select');
    let voiceId = $('#char-voice-id').value.trim();
    let voiceName = $('#char-voice-name').value;
    if (sel && sel.value) {
        voiceId = sel.value;
        const found = voices.find(x => x.voiceId === voiceId);
        voiceName = found ? found.name : '';
    } else if (sel && !sel.value) {
        voiceId = ''; voiceName = '';
    }
    const data = {
        id: editingCharId || undefined,
        name: $('#char-name').value,
        desc: $('#char-desc').value,
        voice: {
            voiceId, voiceName,
            stability: $('#v-stability').value, similarity: $('#v-similarity').value,
            style: $('#v-style').value, speed: $('#v-speed').value
        }
    };
    if (charFormImageId !== undefined) data.refImageId = charFormImageId;
    return data;
}

// ─── Épisode : titre, numéro, script (analyse à l'étape 2) ────────
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

let episodeChars = [];

async function renderEpisode(pid, eid) {
    const [p, e, chars] = await Promise.all([M.getProject(pid), M.refreshEpisodeAnalyses(pid).then(l => l.find(x => x.id === eid)), M.listCharacters(pid)]);
    episodeChars = chars;
    if (!p || !e) { toast('Épisode introuvable', 'error'); go(p ? '#/p/' + pid : '#/'); return; }
    view.innerHTML =
        '<div class="panel"><a href="#/p/' + pid + '" class="back-link">← ' + esc(p.name) + '</a>' +
            '<div class="grid2" style="grid-template-columns:5rem 1fr">' +
                '<div><label class="lbl" for="ep-number">EP.</label><input type="number" id="ep-number" min="1" max="9999" value="' + e.number + '"></div>' +
                '<div><label class="lbl" for="ep-title">Titre</label><input type="text" id="ep-title" maxlength="120" value="' + esc(e.title) + '"></div>' +
            '</div>' +
        '</div>' +
        '<div class="panel">' +
            '<label class="lbl" for="ep-script">Script balisé</label>' +
            '<div class="btns" style="margin-bottom:0.5rem">' +
                chars.map(c => '<button class="btn small light" data-action="insert-tag" data-tag="@' + esc(c.name) + '">@' + esc(c.name) + '</button>').join('') +
                '<button class="btn small light" data-action="insert-template">＋ Modèle de plan</button>' +
            '</div>' +
            '<textarea class="script" id="ep-script" spellcheck="false" placeholder="' + esc(PLAN_TEMPLATE) + '">' + esc(e.script) + '</textarea>' +
            '<div class="save-state" id="save-state">Enregistré</div>' +
            '<details class="hint"><summary>Aide sur les balises</summary>' + SYNTAX_HELP + '</details>' +
        '</div>' +
        '<div class="panel" id="analysis"></div>' +
        '<button class="btn danger block" data-action="delete-episode">Supprimer cet épisode</button>';
    view.dataset.pid = pid;
    view.dataset.eid = eid;
    renderAnalysis(e.analysis || parseScript(e.script, chars));
}

const SYNTAX_HELP =
    '<div style="margin-top:0.4rem;line-height:1.6">' +
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

const MOVE_LABELS = { 'fixe': 'fixe', 'zoom-in': 'zoom avant', 'zoom-out': 'zoom arrière', 'pan-gauche': 'pan ←', 'pan-droite': 'pan →',
    'pan-haut': 'pan ↑', 'pan-bas': 'pan ↓', 'tremblement': 'tremblement' };
const TRANS_LABELS = { 'coupe': 'coupe', 'fondu': 'fondu', 'fondu-noir': 'fondu au noir', 'fondu-blanc': 'fondu au blanc',
    'glisse-gauche': 'glisse ←', 'glisse-droite': 'glisse →', 'flash': 'flash' };

let lastAnalysis = null;

function renderAnalysis(a) {
    lastAnalysis = a;
    const box = $('#analysis');
    if (!box || !a) return;
    const st = a.stats;
    const t = st.target;
    const inTarget = st.estimatedSeconds >= t.min && st.estimatedSeconds <= t.max;
    const head = a.errors.length
        ? '<div class="an-head bad">❌ ' + a.errors.length + ' erreur' + (a.errors.length > 1 ? 's' : '') + ' à corriger</div>'
        : st.plans
            ? '<div class="an-head ok">✅ ' + st.plans + ' plan' + (st.plans > 1 ? 's' : '') + ' prêt' + (st.plans > 1 ? 's' : '') + '</div>'
            : '<div class="an-head">Script vide</div>';
    const issues = a.errors.concat(a.warnings).sort((x, y) => x.line - y.line).map(i =>
        '<button class="issue ' + i.severity + '" data-action="goto-line" data-line="' + i.line + '">' +
        '<span class="issue-line">L.' + i.line + '</span>' + (i.severity === 'error' ? '❌ ' : '⚠️ ') + esc(i.message) + '</button>').join('');
    const plans = a.plans.map(p => {
        const cam = p.cam.moves.map(m => MOVE_LABELS[m.type] + (m.speed !== 'normal' ? ' ' + m.speed : '') +
            (m.intensity !== 'normal' ? ' ' + (m.intensity === 'leger' ? 'léger' : m.intensity) : '')).join(' + ');
        const dur = p.duration.mode === 'audio' ? '~' + p.duration.estimate + ' s (voix)'
            : p.duration.seconds + ' s' + (p.duration.mode === 'fixed' ? ' (imposée)' : ' (défaut)');
        const music = p.musique.action === 'start' ? '🎵 ' + esc(p.musique.label || p.musique.track) + ' ▶'
            : p.musique.action === 'stop' ? '🎵 stop' : '';
        return '<div class="plan-card" data-action="goto-line" data-line="' + p.line + '">' +
            '<div class="plan-top"><b>' + p.id + '</b>' + (p.title ? ' · ' + esc(p.title) : '') +
                '<span class="plan-dur">⏱ ' + dur + '</span></div>' +
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
        '<div class="section-title" style="margin-bottom:0.6rem">🧩 Plans (analyse du script)</div>' + head +
        (st.plans ? '<div class="an-stats">' + st.voix + ' réplique' + (st.voix > 1 ? 's' : '') + ' · ' + st.sfx + ' son' + (st.sfx > 1 ? 's' : '') +
            ' · ' + st.characters.length + ' personnage' + (st.characters.length > 1 ? 's' : '') +
            ' · durée estimée ~' + fmtDuration(st.estimatedSeconds) +
            ' <span class="' + (inTarget ? 'ok' : 'off') + '">(objectif 3–6 min' + (inTarget ? ' ✓' : '') + ')</span>' +
            (st.tracks.length ? '<br>Musiques à importer : ' + st.tracks.map(esc).join(', ') : '') + '</div>' : '') +
        (issues ? '<div class="issues">' + issues + '</div>' : '') +
        plans +
        (st.plans ? '<details class="json-box"><summary>JSON des plans</summary>' +
            '<div class="btns" style="margin:0.5rem 0"><button class="btn small light" data-action="copy-json">Copier</button>' +
            '<button class="btn small light" data-action="download-json">Télécharger</button></div>' +
            '<pre class="json">' + esc(JSON.stringify(a.plans, null, 2)) + '</pre></details>' : '');
}

function gotoLine(line) {
    const ta = $('#ep-script');
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
    const ta = $('#ep-script');
    if (!ta) return;
    const eid = view.dataset.eid;
    const state = $('#save-state');
    if (state) state.textContent = 'Modification…';
    pendingScriptSave = { eid, script: ta.value };
    clearTimeout(scriptSaveTimer);
    scriptSaveTimer = setTimeout(flushScriptSave, 500);
}
async function flushScriptSave() {
    clearTimeout(scriptSaveTimer);
    const job = pendingScriptSave;
    pendingScriptSave = null;
    if (!job) return;
    try {
        const e = await M.saveEpisodeScript(job.eid, job.script);
        const state = $('#save-state');
        if (state && view.dataset.eid === job.eid) {
            state.textContent = 'Enregistré ✓';
            renderAnalysis(e.analysis);
        }
    } catch (e) { fail(e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushScriptSave(); });
window.addEventListener('pagehide', flushScriptSave);

function insertAtCursor(ta, text) {
    const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(en);
    ta.focus();
    ta.setSelectionRange(s + text.length, s + text.length);
    scheduleScriptSave();
}

// ─── Actions ──────────────────────────────────────────────────────
const actions = {
    async 'save-key'() {
        EL.setKey($('#el-key').value);
        voices = null;
        toast(EL.getKey() ? 'Clé ElevenLabs enregistrée' : 'Clé supprimée', EL.getKey() ? 'success' : 'warn');
        render();
    },
    async 'test-key'() {
        const st = $('#key-status');
        st.textContent = 'Vérification…';
        try {
            voices = await EL.listVoices({ force: true });
            st.textContent = '✅ Clé valide : ' + voices.length + ' voix disponibles.';
        } catch (e) { st.textContent = '⚠️ ' + e.message; }
    },
    async 'create-project'() {
        const p = await M.createProject({ name: $('#new-name').value, styleText: $('#new-style').value });
        toast('Série « ' + p.name + ' » créée');
        go('#/p/' + p.id);
    },
    async 'import-project'() {
        const file = await pickFile('import-input');
        if (!file) return;
        let data;
        try { data = JSON.parse(await file.text()); } catch (e) { throw new M.DramaError('Fichier illisible'); }
        const p = await M.importProject(data);
        toast('Série « ' + p.name + ' » importée');
        go('#/p/' + p.id);
    },
    async 'rename-project'() {
        const p = await M.getProject(view.dataset.pid);
        const name = prompt('Nouveau titre de la série', p.name);
        if (name == null) return;
        await M.updateProject(p.id, { name });
        render();
    },
    async 'save-style'() {
        await M.updateProject(view.dataset.pid, { style: {
            text: $('#style-text').value, negative: $('#style-neg').value, seed: $('#style-seed').value
        }});
        toast('Style enregistré');
        render();
    },
    async 'toggle-lock'() {
        const p = await M.getProject(view.dataset.pid);
        if (p.style.locked) {
            if (!confirm('Déverrouiller le style ? Les images déjà générées ne suivront plus forcément le nouveau style.')) return;
            await M.setStyleLocked(p.id, false);
            toast('Style déverrouillé', 'warn');
        } else {
            // enregistre d'abord les champs saisis, puis verrouille
            await M.updateProject(p.id, { style: { text: $('#style-text').value, negative: $('#style-neg').value, seed: $('#style-seed').value } });
            await M.setStyleLocked(p.id, true);
            toast('Style verrouillé 🔒');
        }
        render();
    },
    async 'random-seed'() { $('#style-seed').value = Math.floor(Math.random() * 2147483647); },
    async 'pick-style-image'() {
        const file = await pickFile('image-input');
        if (!file) return;
        const pid = view.dataset.pid;
        const a = await M.saveImageAsset(pid, file, 'style');
        try { await M.updateProject(pid, { style: { refImageId: a.id } }); }
        catch (e) { await M.deleteAsset(a.id); throw e; }
        toast('Image de référence du style enregistrée');
        render();
    },
    async 'remove-style-image'() {
        await M.updateProject(view.dataset.pid, { style: { refImageId: null } });
        render();
    },
    async 'edit-char'(el) {
        editingCharId = el.dataset.id;
        await discardCharFormImage();
        await render();
        $('#char-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async 'cancel-char'() {
        editingCharId = null;
        await discardCharFormImage();
        render();
    },
    async 'delete-char'(el) {
        const chars = await M.listCharacters(view.dataset.pid);
        const c = chars.find(x => x.id === el.dataset.id);
        if (!c || !confirm('Supprimer la fiche @' + c.name + ' ?')) return;
        await M.deleteCharacter(c.id);
        if (editingCharId === c.id) { editingCharId = null; await discardCharFormImage(); }
        toast('Fiche @' + c.name + ' supprimée', 'warn');
        render();
    },
    async 'pick-char-image'() {
        const file = await pickFile('image-input');
        if (!file) return;
        await discardCharFormImage();
        const a = await M.saveImageAsset(view.dataset.pid, file, 'character');
        charFormImageId = a.id;
        await keepCharFormAndRerender();
    },
    async 'remove-char-image'() {
        await discardCharFormImage();
        charFormImageId = null;
        await keepCharFormAndRerender();
    },
    async 'load-voices'() {
        voices = await EL.listVoices({ force: true });
        toast(voices.length + ' voix chargées');
        await keepCharFormAndRerender();
    },
    async 'preview-voice'() {
        const sel = $('#char-voice-select');
        const id = sel ? sel.value : $('#char-voice-id').value.trim();
        if (!id) { toast('Choisissez d\'abord une voix', 'warn'); return; }
        if (!voices) voices = await EL.listVoices();
        const v = voices.find(x => x.voiceId === id);
        if (!v || !v.previewUrl) { toast('Pas d\'extrait pour cette voix', 'warn'); return; }
        if (previewAudio) previewAudio.pause();
        previewAudio = new Audio(v.previewUrl);
        await previewAudio.play();
    },
    async 'save-char'() {
        const pid = view.dataset.pid;
        const c = await M.saveCharacter(pid, readCharForm());
        const wasEditing = !!editingCharId;
        editingCharId = null;
        charFormImageId = undefined;
        toast(wasEditing ? 'Fiche @' + c.name + ' mise à jour' : 'Fiche @' + c.name + ' créée');
        render();
    },
    async 'new-episode'() {
        const e = await M.createEpisode(view.dataset.pid);
        go('#/p/' + view.dataset.pid + '/e/' + e.id);
    },
    async 'delete-episode'() {
        if (!confirm('Supprimer cet épisode et son script ?')) return;
        pendingScriptSave = null;
        await M.deleteEpisode(view.dataset.eid);
        toast('Épisode supprimé', 'warn');
        go('#/p/' + view.dataset.pid);
    },
    async 'goto-line'(el) { gotoLine(parseInt(el.dataset.line, 10)); },
    async 'copy-json'() {
        await navigator.clipboard.writeText(JSON.stringify(lastAnalysis.plans, null, 2));
        toast('JSON copié');
    },
    async 'download-json'() {
        const ep = (await M.listEpisodes(view.dataset.pid)).find(x => x.id === view.dataset.eid);
        const blob = new Blob([JSON.stringify({ episode: ep.number, title: ep.title, ...lastAnalysis }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ep' + ep.number + '-plans.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    },
    async 'insert-tag'(el) { insertAtCursor($('#ep-script'), el.dataset.tag + ' '); },
    async 'insert-template'() {
        const ta = $('#ep-script');
        const n = (ta.value.match(/^\s*\[PLAN\]/gim) || []).length + 1;
        const prefix = ta.value && !ta.value.endsWith('\n') ? '\n\n' : (ta.value ? '\n' : '');
        ta.setSelectionRange(ta.value.length, ta.value.length);
        insertAtCursor(ta, prefix + PLAN_TEMPLATE.replace('[PLAN] 1', '[PLAN] ' + n));
    },
    async 'export-project'() {
        const data = await M.exportProject(view.dataset.pid);
        const slug = M.normalizeName(data.project.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'serie';
        const name = 'drama-' + slug + '-' + new Date().toISOString().slice(0, 10) + '.json';
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file], title: data.project.name }); return; }
            catch (e) { if (e && e.name === 'AbortError') return; }
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        toast('Sauvegarde téléchargée');
    },
    async 'delete-project'() {
        const p = await M.getProject(view.dataset.pid);
        if (!confirm('Supprimer définitivement « ' + p.name + ' », ses personnages et ses épisodes ?')) return;
        await M.deleteProject(p.id);
        toast('Série supprimée', 'warn');
        go('#/');
    }
};

// Image choisie dans le formulaire mais pas encore enregistrée : on la jette si on l'abandonne.
async function discardCharFormImage() {
    if (charFormImageId) {
        const chars = await M.listCharacters(view.dataset.pid);
        if (!chars.some(c => c.refImageId === charFormImageId)) await M.deleteAsset(charFormImageId);
    }
    charFormImageId = undefined;
}

// Re-dessine le formulaire personnage sans perdre ce qui est déjà saisi.
async function keepCharFormAndRerender() {
    const typed = readCharForm();
    const chars = await M.listCharacters(view.dataset.pid);
    const base = editingCharId ? chars.find(c => c.id === editingCharId) : null;
    await renderCharForm(view.dataset.pid, {
        ...(base || {}), id: editingCharId, name: typed.name, desc: typed.desc,
        voice: { ...M.DEFAULT_VOICE, ...typed.voice }, refImageId: base ? base.refImageId : null
    });
    if (!base) {
        // formulaire « nouveau » : garder le titre et le bouton d'origine
        $('#char-form .section-title').textContent = 'Nouveau personnage';
        const btn = $('#char-form [data-action="save-char"]');
        if (btn) btn.textContent = 'Enregistrer le personnage';
        const cancel = $('#char-form [data-action="cancel-char"]');
        if (cancel) cancel.remove();
    }
}

view.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-action], [data-go]');
    if (!el || !view.contains(el)) return;
    if (el.dataset.go && !el.dataset.action) { go(el.dataset.go); return; }
    const fn = actions[el.dataset.action];
    if (!fn || el.disabled) return;
    if (el.tagName === 'BUTTON') el.disabled = true;
    try { await fn(el); } catch (e) { fail(e); }
    finally { if (el.isConnected && el.tagName === 'BUTTON') el.disabled = false; }
});

view.addEventListener('input', ev => {
    const t = ev.target;
    if (t.id === 'ep-script') scheduleScriptSave();
    else if (t.type === 'range') { const out = $('#' + t.id + '-val'); if (out) out.textContent = t.value; }
    else if (t.id === 'el-key') { const b = $('[data-action="test-key"]'); if (b) b.disabled = true; }
});

view.addEventListener('change', async ev => {
    const t = ev.target;
    try {
        if (t.id === 'voice-model') {
            await M.updateProject(view.dataset.pid, { voiceModel: t.value });
            toast('Modèle de voix enregistré');
        } else if (t.id === 'ep-title') {
            await M.updateEpisode(view.dataset.eid, { title: t.value });
            $('#save-state').textContent = 'Enregistré ✓';
        } else if (t.id === 'ep-number') {
            const e = await M.updateEpisode(view.dataset.eid, { number: t.value }).catch(err => { fail(err); return null; });
            if (!e) { const cur = (await M.listEpisodes(view.dataset.pid)).find(x => x.id === view.dataset.eid); t.value = cur.number; return; }
            $('#save-state').textContent = 'Enregistré ✓';
        }
    } catch (e) { fail(e); }
});

view.addEventListener('toggle', ev => {
    const d = ev.target;
    if (d.dataset && d.dataset.sec && view.dataset.pid) {
        (openSections[view.dataset.pid] = openSections[view.dataset.pid] || {})[d.dataset.sec] = d.open;
    }
}, true);

view.addEventListener('focusout', ev => { if (ev.target.id === 'ep-script') flushScriptSave(); });

render();
