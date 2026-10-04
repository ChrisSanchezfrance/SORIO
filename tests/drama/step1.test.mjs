// Étape 1 — projet série : style verrouillé, fiches personnages (image + voix), épisodes,
// dans l'onglet « 🎬 Drama » de l'appli. Scénario : une série, 2 personnages, un épisode
// de 5 plans ; tout doit survivre au rechargement, à l'export puis à l'import.
// Lancer : node tests/drama/step1.test.mjs
import { loadPlaywright, startServer, check, done, makePng, inApp, choose, waitToast } from './helpers.mjs';
import { SCRIPT_5_PLANS } from './fixtures.mjs';

const VOICES = { voices: [
    { voice_id: 'voice_lina', name: 'Lina FR', category: 'cloned', preview_url: 'https://example.invalid/lina.mp3', labels: { gender: 'female', accent: 'french' } },
    { voice_id: 'voice_marc', name: 'Marc FR', category: 'premade', preview_url: 'https://example.invalid/marc.mp3', labels: { gender: 'male', age: 'young' } }
]};

const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Néons Brisés — saison 1' : undefined));
let voiceCalls = 0;
await ctx.route('https://api.elevenlabs.io/**', r => {
    voiceCalls++;
    const ok = r.request().headers()['xi-api-key'] === 'el-test-key';
    return r.fulfill(ok ? { json: VOICES } : { status: 401, json: { detail: 'invalid' } });
});
const click = sel => page.click(sel);
const counts = () => inApp(page, async ({ DB }) => {
    const out = {};
    for (const s of DB.STORES) out[s] = (await DB.getAll(s)).length;
    return out;
});

try {
    console.log('Étape 1 — projet série dans l\'onglet Drama (test sur 5 plans)');

    // Onglets de l'appli
    await page.goto(url + '/atelier/');
    check(await page.locator('[data-app-tab]').count() === 2 && await page.isVisible('#upload-zone'), 'onglets « Vidéos | Drama », Vidéos affiché au départ');
    await click('[data-app-tab="drama"]');
    await page.waitForSelector('#d-new-name');
    check(!(await page.isVisible('#upload-zone')) && page.url().endsWith('#drama'), 'onglet Drama : contenu Vidéos masqué, adresse #drama');

    // Clé ElevenLabs
    await click('[data-action="eleven-edit"]');
    await page.fill('#d-eleven-key', 'el-test-key');
    await click('[data-action="save-eleven"]');
    await page.waitForFunction(() => /clé active/.test(document.getElementById('d-eleven')?.textContent || ''));
    await page.waitForSelector('[data-action="test-eleven"]:not([disabled])');
    await click('[data-action="test-eleven"]');
    await page.waitForFunction(() => /2 voix/.test(document.getElementById('d-eleven-status').textContent));
    check(true, 'clé ElevenLabs enregistrée et vérifiée : 2 voix trouvées');

    // Création de la série
    await page.fill('#d-new-name', 'Néons Brisés');
    await page.fill('#d-new-style', 'manhwa dramatique, couleurs froides, néons, traits fins');
    await click('[data-action="create-project"]');
    await page.waitForSelector('#d-sec-style.open');
    check(await page.$eval('#d-series', s => s.options[s.selectedIndex].text) === 'Néons Brisés', 'série créée et sélectionnée en haut de l\'onglet');
    check(await page.locator('#drama-root .section').count() === 7, '7 sections : Style, Personnages, Épisodes, Script, Images, Voix, Sauvegarde');

    // Image de référence du style puis verrouillage
    await choose(page, '[data-action="pick-style-image"]', await makePng(page, 2000, 3000, '#224466'));
    await page.waitForSelector('img.d-ref');
    await page.fill('#d-style-neg', 'texte, filigrane, 3D');
    await click('[data-action="toggle-lock"]');
    await page.waitForSelector('#d-sec-style .lock-banner.locked');
    check(await page.isDisabled('#d-style-text') && await page.textContent('#d-badge-style') === '🔒 verrouillé', 'style verrouillé : champs non modifiables, badge « 🔒 verrouillé »');
    const locked = await inApp(page, async ({ M }) => {
        const p = (await M.listProjects())[0];
        let refused = false;
        try { await M.updateProject(p.id, { style: { text: 'autre style' } }); } catch (e) { refused = /verrouillé/.test(e.message); }
        const ref = await M.getAsset(p.style.refImageId);
        return { refused, neg: p.style.negative, refW: ref.width, refH: ref.height };
    });
    check(locked.refused, 'modification du style refusée tant qu\'il est verrouillé');
    check(locked.neg === 'texte, filigrane, 3D', '« à éviter » enregistré avant verrouillage');
    check(locked.refW === 1024 && locked.refH === 1536, 'image de référence réduite à 1536 px max (2000×3000 → 1024×1536)');

    // Personnages : Lina et Marc, chacun avec photo et voix
    await page.waitForSelector('#d-sec-chars.open');
    await click('[data-action="load-voices"]');
    await page.waitForSelector('#d-char-voice-select');
    for (const [name, desc, color, voice] of [
        ['Lina', 'Femme de 28 ans, carré noir, yeux verts, trench beige', '#aa3355', 'voice_lina'],
        ['Marc', 'Homme de 30 ans, cheveux bruns en bataille, blouson de cuir', '#3355aa', 'voice_marc']
    ]) {
        await page.fill('#d-char-name', name);
        await page.fill('#d-char-desc', desc);
        await choose(page, '[data-action="pick-char-image"]', await makePng(page, 800, 1200, color));
        await page.waitForSelector('#d-char-form img.char-photo-preview');
        check(await page.inputValue('#d-char-name') === name && await page.inputValue('#d-char-desc') === desc, name + ' : saisie conservée après le choix de la photo');
        await page.selectOption('#d-char-voice-select', voice);
        await page.fill('#d-v-stability', '0.35');
        await click('[data-action="save-char"]');
        await page.waitForFunction(n => [...document.querySelectorAll('#drama-root .char-tag')].some(t => t.textContent === '@' + n), name);
    }
    check(await page.locator('#drama-root .char-card').count() === 2 && await page.textContent('#d-badge-chars') === '2', '2 fiches personnages, badge « 2 »');

    // Doublon et nom invalide refusés
    await page.fill('#d-char-name', 'lina');
    await click('[data-action="save-char"]');
    await waitToast(page, /existe déjà/);
    check(true, 'doublon @lina refusé');
    await page.fill('#d-char-name', 'Lina Rose');
    await click('[data-action="save-char"]');
    await waitToast(page, /un seul mot/);
    check(true, 'nom avec espace refusé');

    // Modèle de voix de la série
    await page.selectOption('#d-voice-model', 'eleven_turbo_v2_5');
    await waitToast(page, /Modèle de voix/);

    // Épisode 1 : script de 5 plans saisi au clavier (autosauvegarde)
    await click('[data-action="new-episode"]');
    await page.waitForSelector('#d-script');
    await page.fill('#d-ep-title', 'La promesse');
    await page.locator('#d-ep-title').dispatchEvent('change');
    await page.locator('#d-script').click();
    await page.keyboard.insertText(SCRIPT_5_PLANS);
    await page.waitForFunction(() => /Enregistré ✓/.test(document.getElementById('d-save-state').textContent));
    check(true, 'script autosauvegardé');

    // Deuxième épisode puis conflit de numéro
    await click('[data-action="new-episode"]');
    await page.waitForFunction(() => document.getElementById('d-ep-number')?.value === '2');
    check(true, 'numérotation automatique : EP.2 devient l\'épisode en cours');
    await page.fill('#d-ep-number', '1');
    await page.locator('#d-ep-number').dispatchEvent('change');
    await waitToast(page, /existe déjà/);
    check(await page.inputValue('#d-ep-number') === '2', 'numéro déjà pris refusé (EP.1)');

    // Retour sur EP.1 depuis la liste
    await click('#drama-root .d-ep:has-text("La promesse")');
    await page.waitForFunction(() => document.getElementById('d-ep-number')?.value === '1');
    check(await page.inputValue('#d-script') === SCRIPT_5_PLANS, 'toucher EP.1 dans la liste rouvre son script');

    // Rechargement complet : tout est conservé, EP.1 reste l'épisode en cours
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    const state = await inApp(page, async ({ M }) => {
        const p = (await M.listProjects())[0];
        const [chars, eps] = await Promise.all([M.listCharacters(p.id), M.listEpisodes(p.id)]);
        const imgs = await Promise.all(chars.map(c => M.getAsset(c.refImageId)));
        return {
            locked: p.style.locked, model: p.voiceModel,
            chars: chars.map((c, i) => [c.name, c.voice.voiceId, c.voice.voiceName, c.voice.stability, !!imgs[i] && imgs[i].blob.size > 0]),
            eps: eps.map(e => ({ n: e.number, title: e.title, script: e.script }))
        };
    });
    check(state.locked && state.model === 'eleven_turbo_v2_5', 'après rechargement : style verrouillé + modèle de voix');
    check(JSON.stringify(state.chars) === JSON.stringify([['Lina', 'voice_lina', 'Lina FR', 0.35, true], ['Marc', 'voice_marc', 'Marc FR', 0.35, true]]),
        'après rechargement : 2 personnages avec voix, réglages et photo');
    const ep1 = state.eps.find(e => e.n === 1);
    check(ep1 && ep1.title === 'La promesse' && ep1.script === SCRIPT_5_PLANS && (ep1.script.match(/^\[PLAN\]/gm) || []).length === 5,
        'après rechargement : EP.1 « La promesse », script de 5 plans intact');
    check(page.url().endsWith('#drama') && await page.inputValue('#d-ep-number') === '1', 'après rechargement : onglet Drama et EP.1 rouverts');
    check(/5 plans · ✅ prêt/.test(await page.textContent('#drama-root .d-ep:has-text("La promesse")')), 'liste des épisodes : « 5 plans · ✅ prêt »');

    // Renommer la série
    await page.evaluate(() => { document.getElementById('d-sec-backup').classList.add('open'); });
    await click('[data-action="rename-project"]');
    await page.waitForFunction(() => { const s = document.getElementById('d-series'); return s && s.options[s.selectedIndex].text === 'Néons Brisés — saison 1'; });
    check(true, 'série renommée');

    // Export → suppression → import : contenu identique
    await page.evaluate(() => { document.getElementById('d-sec-backup').classList.add('open'); });
    const [download] = await Promise.all([page.waitForEvent('download'), click('[data-action="export-full"]')]);
    const exportPath = await download.path();
    check(/^drama-neons-brises-saison-1-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), 'export : ' + download.suggestedFilename());
    await page.evaluate(() => { document.getElementById('d-sec-backup').classList.add('open'); });
    await click('[data-action="delete-project"]');
    await page.waitForSelector('#d-new-name');
    const left = await counts();
    check(Object.values(left).every(n => n === 0), 'suppression : projet, personnages, épisodes et images effacés ' + JSON.stringify(left));
    await choose(page, '#d-new [data-action="import-project"]', exportPath);
    await page.waitForSelector('#d-sec-style .lock-banner.locked');
    const imported = await inApp(page, async ({ M }) => {
        const p = (await M.listProjects())[0];
        const [chars, eps] = await Promise.all([M.listCharacters(p.id), M.listEpisodes(p.id)]);
        const ref = await M.getAsset(p.style.refImageId);
        const cimgs = await Promise.all(chars.map(c => M.getAsset(c.refImageId)));
        return { name: p.name, locked: p.style.locked, refOk: !!ref && ref.width === 1024,
            chars: chars.map(c => c.name + ':' + c.voice.voiceId), charImgs: cimgs.every(a => a && a.projectId === p.id),
            script: eps.find(e => e.number === 1).script, epCount: eps.length };
    });
    check(imported.name === 'Néons Brisés — saison 1' && imported.locked && imported.refOk, 'import : série, style verrouillé et image de référence restaurés');
    check(imported.chars.join(',') === 'Lina:voice_lina,Marc:voice_marc' && imported.charImgs, 'import : personnages, voix et photos restaurés');
    check(imported.epCount === 2 && imported.script === SCRIPT_5_PLANS, 'import : 2 épisodes, script de 5 plans identique');

    // L'onglet Vidéos est intact
    await click('[data-app-tab="video"]');
    await page.waitForSelector('#upload-zone', { state: 'visible' });
    check(!(await page.isVisible('#drama-root')) && await page.isVisible('#api-key-input'), 'retour à l\'onglet Vidéos : Drama masqué, Vidéos affiché');

    await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: true }).catch(() => {});
    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
    check(voiceCalls >= 2, 'ElevenLabs appelé uniquement pour lister les voix (' + voiceCalls + ' appels, aucune synthèse)');
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
