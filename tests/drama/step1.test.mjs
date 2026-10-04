// Étape 1 — projet série : style verrouillé, fiches personnages (image + voix), épisodes.
// Scénario : une série, 2 personnages, un épisode de 5 plans ; tout doit survivre
// au rechargement, à l'export puis à l'import.
// Lancer : node tests/drama/step1.test.mjs
import { loadPlaywright, startServer, check, done, makePng } from './helpers.mjs';

const SCRIPT_5_PLANS = `[PLAN] 1
[DECOR] Toit d'immeuble, nuit, pluie
[PERSOS] @Lina
[IMAGE] Lina seule au bord du toit, ville néon en contrebas
[CAM] zoom-in lent
[MUSIQUE] tension

[PLAN] 2
[DECOR] Toit d'immeuble, nuit, pluie
[PERSOS] @Lina @Marc
[IMAGE] Marc surgit derrière elle, essoufflé
[CAM] pan-gauche ; transition: fondu
[VOIX] @Marc: « Lina, attends ! »
[SFX] porte-claque @0.2s

[PLAN] 3
[DECOR] Toit d'immeuble, nuit, pluie
[PERSOS] @Lina
[IMAGE] Gros plan sur Lina, larmes et pluie mêlées
[CAM] tremblement léger
[VOIX] @Lina: « Tu m'as menti. »

[PLAN] 4
[DECOR] Toit d'immeuble, nuit, pluie
[PERSOS] @Marc
[IMAGE] Marc baisse les yeux, la main tendue
[CAM] zoom-out lent
[VOIX] @Marc (chuchoté): « Je voulais te protéger. »

[PLAN] 5
[DECOR] Toit d'immeuble, nuit, éclair
[PERSOS] @Lina @Marc
[IMAGE] Un éclair illumine les deux silhouettes face à face
[CAM] fixe ; transition: fondu au noir
[SFX] tonnerre @0.0s
[MUSIQUE] stop
`;

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

const DRAMA = url + '/atelier/drama/';
const click = sel => page.click(sel);
// Touche le bouton puis choisit le fichier dans le sélecteur, comme sur le téléphone.
async function choose(sel, file) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click(sel)]);
    await chooser.setFiles(file);
}
const toastText = () => page.textContent('#toast-text');

try {
    console.log('Étape 1 — projet série (test sur 5 plans)');

    // Entrée depuis l'Atelier
    await page.goto(url + '/atelier/');
    check(await page.locator('a[href="drama/"]').count() === 1, 'bouton « Drama » présent dans l\'Atelier');
    await click('a[href="drama/"]');
    await page.waitForSelector('#el-key');

    // Clé ElevenLabs
    await page.fill('#el-key', 'el-test-key');
    await click('[data-action="save-key"]');
    await page.waitForSelector('[data-action="test-key"]:not([disabled])');
    await click('[data-action="test-key"]');
    await page.waitForFunction(() => /2 voix/.test(document.getElementById('key-status').textContent));
    check(true, 'clé ElevenLabs vérifiée : 2 voix trouvées');

    // Création de la série
    await page.fill('#new-name', 'Néons Brisés');
    await page.fill('#new-style', 'manhwa dramatique, couleurs froides, néons, traits fins');
    await click('[data-action="create-project"]');
    await page.waitForSelector('#style-text');
    const pid = page.url().split('#/p/')[1];
    check(!!pid, 'série créée et ouverte');

    // Image de référence du style puis verrouillage
    await choose('[data-action="pick-style-image"]', await makePng(page, 2000, 3000, '#224466'));
    await page.waitForSelector('img.ref-preview');
    await page.fill('#style-neg', 'texte, filigrane, 3D');
    await page.fill('#style-seed', '424242');
    await click('[data-action="toggle-lock"]');
    await page.waitForSelector('.lock-banner.locked');
    check(await page.isDisabled('#style-text'), 'style verrouillé : champs non modifiables');
    const locked = await page.evaluate(async pid => {
        const M = await import('./js/model.js');
        const before = await M.getProject(pid);
        let refused = false;
        try { await M.updateProject(pid, { style: { text: 'autre style' } }); } catch (e) { refused = /verrouillé/.test(e.message); }
        const ref = await M.getAsset(before.style.refImageId);
        return { refused, seed: before.style.seed, neg: before.style.negative, refW: ref.width, refH: ref.height };
    }, pid);
    check(locked.refused, 'modification du style refusée tant qu\'il est verrouillé');
    check(locked.seed === 424242 && locked.neg === 'texte, filigrane, 3D', 'graine et « à éviter » enregistrés avant verrouillage');
    check(locked.refW === 1024 && locked.refH === 1536, 'image de référence réduite à 1536 px max (2000×3000 → 1024×1536)');

    // Personnages : Lina et Marc, chacun avec image et voix
    await click('[data-action="load-voices"]');
    await page.waitForSelector('#char-voice-select');
    for (const [name, desc, color, voice] of [
        ['Lina', 'Femme de 28 ans, carré noir, yeux verts, trench beige', '#aa3355', 'voice_lina'],
        ['Marc', 'Homme de 30 ans, cheveux bruns en bataille, blouson de cuir', '#3355aa', 'voice_marc']
    ]) {
        await page.fill('#char-name', name);
        await page.fill('#char-desc', desc);
        await choose('[data-action="pick-char-image"]', await makePng(page, 800, 1200, color));
        await page.waitForSelector('#char-form img.ref-preview');
        check(await page.inputValue('#char-name') === name, name + ' : saisie conservée après choix de la photo');
        await page.selectOption('#char-voice-select', voice);
        await page.fill('#v-stability', '0.35');
        await click('[data-action="save-char"]');
        await page.waitForFunction(n => document.querySelectorAll('.card-title').length && [...document.querySelectorAll('.card-title')].some(t => t.textContent === '@' + n), name);
    }
    check((await page.locator('.card.static').count()) === 2, '2 fiches personnages affichées');

    // Doublon de nom refusé (insensible à la casse et aux accents)
    await page.fill('#char-name', 'lina');
    await click('[data-action="save-char"]');
    await page.waitForFunction(() => /existe déjà/.test(document.getElementById('toast-text').textContent));
    check(true, 'doublon @lina refusé');
    await page.fill('#char-name', 'Lina Rose');
    await click('[data-action="save-char"]');
    await page.waitForFunction(() => /un seul mot/.test(document.getElementById('toast-text').textContent));
    check(true, 'nom avec espace refusé');

    // Modèle de voix de la série
    await page.selectOption('#voice-model', 'eleven_turbo_v2_5');
    await page.waitForFunction(() => /Modèle de voix/.test(document.getElementById('toast-text').textContent));

    // Épisode 1 : script de 5 plans saisi au clavier (autosauvegarde)
    await click('[data-action="new-episode"]');
    await page.waitForSelector('#ep-script');
    await page.fill('#ep-title', 'La promesse');
    await page.locator('#ep-title').dispatchEvent('change');
    await page.locator('#ep-script').click();
    await page.keyboard.insertText(SCRIPT_5_PLANS);
    await page.waitForFunction(() => /Enregistré ✓/.test(document.getElementById('save-state').textContent));
    check(true, 'script autosauvegardé');

    // Deuxième épisode puis conflit de numéro
    await click('.panel .back-link');
    await page.waitForSelector('[data-action="new-episode"]');
    await click('[data-action="new-episode"]');
    await page.waitForSelector('#ep-number');
    check(await page.inputValue('#ep-number') === '2', 'numérotation automatique : EP.2');
    await page.fill('#ep-number', '1');
    await page.locator('#ep-number').dispatchEvent('change');
    await page.waitForFunction(() => /existe déjà/.test(document.getElementById('toast-text').textContent));
    check(await page.inputValue('#ep-number') === '2', 'numéro déjà pris refusé (EP.1)');

    // Rechargement complet : tout est conservé
    await page.goto(DRAMA + '#/p/' + pid);
    await page.reload();
    await page.waitForSelector('.lock-banner.locked');
    const state = await page.evaluate(async pid => {
        const M = await import('./js/model.js');
        const [p, chars, eps] = await Promise.all([M.getProject(pid), M.listCharacters(pid), M.listEpisodes(pid)]);
        const imgs = await Promise.all(chars.map(c => M.getAsset(c.refImageId)));
        return {
            name: p.name, locked: p.style.locked, model: p.voiceModel,
            chars: chars.map((c, i) => ({ name: c.name, voice: c.voice.voiceId, voiceName: c.voice.voiceName, stab: c.voice.stability, img: !!imgs[i] && imgs[i].blob.size > 0 })),
            eps: eps.map(e => ({ n: e.number, title: e.title, script: e.script }))
        };
    }, pid);
    check(state.locked && state.model === 'eleven_turbo_v2_5', 'après rechargement : style verrouillé + modèle de voix');
    check(JSON.stringify(state.chars.map(c => [c.name, c.voice, c.voiceName, c.stab, c.img])) ===
        JSON.stringify([['Lina', 'voice_lina', 'Lina FR', 0.35, true], ['Marc', 'voice_marc', 'Marc FR', 0.35, true]]),
        'après rechargement : 2 personnages avec voix, réglages et image');
    const ep1 = state.eps.find(e => e.n === 1);
    check(ep1 && ep1.title === 'La promesse' && ep1.script === SCRIPT_5_PLANS, 'après rechargement : EP.1 « La promesse », script intact');
    check((ep1.script.match(/^\[PLAN\]/gm) || []).length === 5, 'EP.1 contient bien 5 plans');
    check(await page.locator('.card:has-text("La promesse") .card-sub').first().textContent().then(t => t.startsWith('5 plans')), 'liste des épisodes : « 5 plans »');

    // Renommer la série
    await click('[data-action="rename-project"]');
    await page.waitForFunction(() => document.querySelector('h2').textContent === 'Néons Brisés — saison 1');
    check(true, 'série renommée');

    // Export → suppression → import : contenu identique
    await page.evaluate(() => { document.querySelector('[data-sec="backup"]').open = true; });
    const [download] = await Promise.all([page.waitForEvent('download'), click('[data-action="export-project"]')]);
    const exportPath = await download.path();
    check(/^drama-neons-brises-saison-1-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), 'export : ' + download.suggestedFilename());
    await click('[data-action="delete-project"]');
    await page.waitForSelector('#new-name');
    const left = await page.evaluate(async () => {
        const db = await import('./js/db.js');
        const counts = {};
        for (const s of db.STORES) counts[s] = (await db.getAll(s)).length;
        return counts;
    });
    check(Object.values(left).every(n => n === 0), 'suppression : projet, personnages, épisodes et images effacés ' + JSON.stringify(left));
    await choose('[data-action="import-project"]', exportPath);
    await page.waitForSelector('.lock-banner.locked');
    const pid2 = page.url().split('#/p/')[1];
    const imported = await page.evaluate(async pid => {
        const M = await import('./js/model.js');
        const [p, chars, eps] = await Promise.all([M.getProject(pid), M.listCharacters(pid), M.listEpisodes(pid)]);
        const ref = await M.getAsset(p.style.refImageId);
        const cimgs = await Promise.all(chars.map(c => M.getAsset(c.refImageId)));
        return { name: p.name, locked: p.style.locked, seed: p.style.seed, refOk: !!ref && ref.width === 1024,
            chars: chars.map(c => c.name + ':' + c.voice.voiceId), charImgs: cimgs.every(a => a && a.projectId === pid),
            script: eps.find(e => e.number === 1).script, epCount: eps.length };
    }, pid2);
    check(pid2 !== pid && imported.name === 'Néons Brisés — saison 1' && imported.locked && imported.seed === 424242 && imported.refOk,
        'import : série, style verrouillé, graine et image de référence restaurés');
    check(imported.chars.join(',') === 'Lina:voice_lina,Marc:voice_marc' && imported.charImgs, 'import : personnages, voix et images restaurés');
    check(imported.epCount === 2 && imported.script === SCRIPT_5_PLANS, 'import : 2 épisodes, script de 5 plans identique');

    await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: true }).catch(() => {});
    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
    check(voiceCalls >= 2, 'API ElevenLabs appelée uniquement pour lister les voix (' + voiceCalls + ' appels, aucune synthèse)');
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
