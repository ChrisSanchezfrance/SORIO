// Étape 3 — images des plans avec Agnes (API simulée), dans l'onglet Drama, sur l'épisode de 5 plans.
// Génération, cache, régénération d'un plan seul, versions, script modifié, erreurs, pause, export/import.
// Lancer : node tests/drama/step3.images.test.mjs
import { readFile } from 'node:fs/promises';
import { loadPlaywright, startServer, check, done, openDrama, inApp, waitToast } from './helpers.mjs';
import { SCRIPT_5_PLANS } from './fixtures.mjs';

const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

// ─── API Agnes simulée ────────────────────────────────────────────
const calls = [];
const sc = { fail429: 0, refuse: false, cdnBlocked: false, square: false };
let PNG_TALL, PNG_SQUARE, served = 0;
await ctx.route('https://apihub.agnes-ai.com/v1/images/generations', r => {
    const req = r.request();
    const body = JSON.parse(req.postData());
    calls.push({ body, auth: req.headers()['authorization'] });
    if (sc.refuse) return r.fulfill({ status: 401, json: { error: { message: 'invalid api key' } } });
    if (sc.fail429 > 0) { sc.fail429--; return r.fulfill({ status: 429, json: { error: { message: 'rate limited' } } }); }
    served++;
    const png = sc.square ? PNG_SQUARE : PNG_TALL;
    if (body.return_base64) return r.fulfill({ json: { created: 1, data: [{ b64_json: png.toString('base64') }] } });
    return r.fulfill({ json: { created: 1, data: [{ url: 'https://cdn.agnes.test/img-' + served + '.png', revised_prompt: '' }] } });
});
await ctx.route('https://cdn.agnes.test/**', r => sc.cdnBlocked ? r.abort('failed')
    : r.fulfill({ body: sc.square ? PNG_SQUARE : PNG_TALL, contentType: 'image/png' }));

const badge = () => page.textContent('#d-badge-images');
const chip = plan => page.textContent('[data-chip="' + plan + '"]');
const card = plan => page.locator('#drama-root .d-shot-card[data-plan="' + plan + '"]');
const idle = () => page.waitForSelector('#drama-root [data-action="gen-images"]', { timeout: 60000 });
async function waitCalls(n, timeout = 30000) {
    const t0 = Date.now();
    while (calls.length < n) { if (Date.now() - t0 > timeout) throw new Error('attendu ' + n + ' appels, reçu ' + calls.length); await page.waitForTimeout(100); }
}
const shotsState = () => inApp(page, async ({ IMG, M, DB }) => {
    const p = (await M.listProjects())[0];
    const e = (await M.listEpisodes(p.id))[0];
    const shots = await IMG.getShots(e.id);
    const assets = (await DB.getByProject('assets', p.id)).filter(a => a.kind === 'shot');
    const out = {};
    for (const [id, sh] of shots) out[id] = { current: sh.current, versions: sh.versions.length };
    return { shots: out, assets: assets.length,
        dims: [...new Set(assets.map(a => a.width + 'x' + a.height + ' ' + a.mime))],
        sources: assets.map(a => a.source && a.source.width + 'x' + a.source.height) };
});
const editScript = (from, to) => page.evaluate(([from, to]) => {
    const ta = document.getElementById('d-script');
    ta.value = ta.value.replace(from, to);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}, [from, to]);

try {
    console.log('Étape 3 — images des plans avec Agnes (test sur 5 plans)');
    await page.goto(url + '/atelier/');
    const pngs = await page.evaluate(() => {
        const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
            const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(w / 4, h / 4, w / 2, h / 2);
            return c.toDataURL('image/png').split(',')[1]; };
        return [mk(1472, 2624, '#1d3557'), mk(1024, 1024, '#e63946')];
    });
    PNG_TALL = Buffer.from(pngs[0], 'base64');
    PNG_SQUARE = Buffer.from(pngs[1], 'base64');

    // Série prête : style verrouillé + image de style, Lina et Marc avec photo, EP.1 de 5 plans
    await inApp(page, async ({ M }, script) => {
        const blob = color => new Promise(res => { const c = document.createElement('canvas'); c.width = 600; c.height = 900;
            const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 600, 900); c.toBlob(res, 'image/png'); });
        const p = await M.createProject({ name: 'Néons Brisés', styleText: 'manhwa dramatique, couleurs froides, néons' });
        const styleRef = await M.saveImageAsset(p.id, await blob('#123456'), 'style');
        await M.updateProject(p.id, { style: { negative: 'texte, 3D', refImageId: styleRef.id } });
        await M.setStyleLocked(p.id, true);
        const lina = await M.saveImageAsset(p.id, await blob('#aa3355'), 'character');
        const marc = await M.saveImageAsset(p.id, await blob('#3355aa'), 'character');
        await M.saveCharacter(p.id, { name: 'Lina', desc: 'Femme de 28 ans, carré noir, yeux verts', refImageId: lina.id });
        await M.saveCharacter(p.id, { name: 'Marc', desc: 'Homme de 30 ans, blouson de cuir', refImageId: marc.id });
        const e = await M.createEpisode(p.id, { title: 'La promesse' });
        await M.saveEpisodeScript(e.id, script);
        localStorage.setItem('agnes_api_key', 'sk-test-agnes');
        localStorage.removeItem('drama_agnes_transfer');
    }, SCRIPT_5_PLANS);
    await openDrama(page, url);
    await page.waitForSelector('#d-sec-images.open [data-action="gen-images"]');
    check(await badge() === 'EP.1 · 0/5' && /Générer les 5 images/.test(await page.textContent('[data-action="gen-images"]')), 'section Images : « EP.1 · 0/5 », bouton « Générer les 5 images »');
    check(/clé active/.test(await page.textContent('#d-agnes')), 'clé Agnes de l\'onglet Vidéos reconnue');

    // 1. Génération des 5 images
    await page.click('[data-action="gen-images"]');
    await idle();
    await page.waitForFunction(() => document.getElementById('d-badge-images').textContent === 'EP.1 · 5/5');
    check(calls.length === 5, '5 appels à Agnes pour 5 plans');
    const b1 = calls[0].body, b2 = calls[1].body;
    check(calls.every(c => c.auth === 'Bearer sk-test-agnes' && c.body.model === 'agnes-image-2.1-flash' && c.body.size === '2K' && c.body.ratio === '9:16' && c.body.extra_body.response_format === 'url'),
        'requêtes : clé, modèle agnes-image-2.1-flash, 2K, ratio 9:16, réponse en URL');
    check(b1.image.length === 2 && b2.image.length === 3 && [...b1.image, ...b2.image].every(i => /^data:image\/jpeg;base64,/.test(i)),
        'références envoyées : P1 = Lina + style (2), P2 = Lina + Marc + style (3), en data URI');
    check(b1.prompt.includes('manhwa dramatique') && b1.prompt.includes("Setting: Toit d'immeuble, nuit, pluie.") &&
        b1.prompt.includes('- Lina: Femme de 28 ans, carré noir, yeux verts — same face') && b1.prompt.includes('Scene: Lina seule au bord du toit') &&
        b1.prompt.includes('Avoid: texte, 3D.'), 'prompt P1 : style, décor, fiche de Lina, scène, à éviter');
    let st = await shotsState();
    check(st.assets === 5 && Object.keys(st.shots).length === 5 && st.dims.join() === '1242x2208 image/jpeg', '5 images stockées sur le téléphone en JPEG 1242×2208 (1080×1920 + marge)');
    check(await page.locator('#d-body-images img.d-shot').count() === 5 && /✅ à jour/.test(await chip('P3')), '5 vignettes affichées, état « ✅ à jour »');
    check(/🖼️ 5\/5/.test(await page.textContent('#drama-root .d-ep')), 'liste des épisodes : « 🖼️ 5/5 »');

    // 2. Cache : rien n'est refait
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    check(await badge() === 'EP.1 · 5/5' && await page.isDisabled('[data-action="gen-images"]') && /Toutes les images sont prêtes/.test(await page.textContent('[data-action="gen-images"]')),
        'après rechargement : 5/5, bouton « Toutes les images sont prêtes » désactivé');
    check(calls.length === 5, 'aucun nouvel appel (cache)');

    // 3. Régénérer un seul plan (P3)
    const before = (await shotsState()).shots;
    await card('P3').locator('[data-action="regen-plan"]').click();
    await waitCalls(6);
    await idle();
    await page.waitForFunction(() => /v2\/2/.test(document.querySelector('.d-shot-card[data-plan="P3"]')?.textContent || ''));
    st = await shotsState();
    check(calls.length === 6 && st.shots.P3.versions === 2 && st.shots.P3.current !== before.P3.current, 'régénérer P3 : 1 seul appel, P3 passe en version 2/2');
    check(['P1', 'P2', 'P4', 'P5'].every(p => st.shots[p].current === before[p].current), 'les 4 autres plans sont inchangés');

    // 4. Revenir à la version précédente
    await card('P3').locator('[data-action="shot-version"][data-dir="-1"]').click();
    await page.waitForFunction(() => /v1\/2/.test(document.querySelector('.d-shot-card[data-plan="P3"]')?.textContent || ''));
    check((await shotsState()).shots.P3.current === before.P3.current && /✅ à jour/.test(await chip('P3')), '◀ : retour à la version 1 de P3, toujours à jour');

    // 5. Script modifié : seul P4 est à refaire
    await editScript('Marc baisse les yeux, la main tendue', 'Marc baisse les yeux, la main tendue vers Lina');
    await page.waitForFunction(() => document.getElementById('d-badge-images').textContent === 'EP.1 · 4/5');
    check(/à refaire/.test(await chip('P4')) && /Générer 1 image manquante/.test(await page.textContent('[data-action="gen-images"]')), 'P4 modifié dans le script : « à refaire », bouton « Générer 1 image manquante »');
    await page.click('[data-action="gen-images"]');
    await waitCalls(7);
    await idle();
    await page.waitForFunction(() => document.getElementById('d-badge-images').textContent === 'EP.1 · 5/5');
    check(calls.length === 7 && calls[6].body.prompt.includes('la main tendue vers Lina'), 'seul P4 est régénéré (1 appel, nouveau texte)');

    // 6. Retour à l'ancien texte : l'ancienne image est reprise du cache, sans appel
    await editScript('la main tendue vers Lina', 'la main tendue');
    await page.waitForFunction(() => /en cache/.test(document.querySelector('[data-chip="P4"]')?.textContent || ''));
    check(true, 'texte d\'origine remis : P4 « ♻️ en cache »');
    await page.click('[data-action="gen-images"]');
    await waitToast(page, /reprise du cache/);
    await page.waitForFunction(() => document.getElementById('d-badge-images').textContent === 'EP.1 · 5/5');
    check(calls.length === 7, 'image reprise du cache : aucun appel à Agnes');

    // 7. Erreur 429 : nouvel essai automatique
    sc.fail429 = 1;
    await card('P1').locator('[data-action="regen-plan"]').click();
    await page.waitForFunction(() => /nouvel essai/.test(document.querySelector('[data-chip="P1"]')?.textContent || ''));
    check(/nouvel essai dans \d+ s/.test(await chip('P1')), 'Agnes répond 429 : « ⏸ nouvel essai dans … s »');
    await waitCalls(9, 30000);
    await idle();
    await page.waitForFunction(() => /v2\/2/.test(document.querySelector('.d-shot-card[data-plan="P1"]')?.textContent || ''));
    check(calls.length === 9, 'après l\'attente, nouvel essai réussi (429 + succès = 2 appels)');

    // 8. Image impossible à télécharger par URL : repli en base64
    sc.cdnBlocked = true;
    await card('P2').locator('[data-action="regen-plan"]').click();
    await waitCalls(11);
    await idle();
    await page.waitForFunction(() => /v2\/2/.test(document.querySelector('.d-shot-card[data-plan="P2"]')?.textContent || ''));
    check(!calls[9].body.return_base64 && calls[10].body.return_base64 === true && calls[10].body.extra_body.response_format === 'b64_json',
        'URL bloquée : nouvelle demande en base64, image récupérée');
    check(await page.evaluate(() => localStorage.getItem('drama_agnes_transfer')) === 'b64', 'mode base64 mémorisé pour la suite');
    sc.cdnBlocked = false;
    await card('P5').locator('[data-action="regen-plan"]').click();
    await waitCalls(12);
    await idle();
    check(calls[11].body.return_base64 === true, 'plan suivant : directement en base64 (1 seul appel)');

    // 9. Image carrée renvoyée : recadrée en 9:16
    sc.square = true;
    await card('P4').locator('[data-action="regen-plan"]').click();
    await waitCalls(13);
    await idle();
    st = await shotsState();
    check(st.dims.join() === '1242x2208 image/jpeg' && st.sources.includes('1024x1024'), 'image 1024×1024 recadrée au centre en 1242×2208');
    sc.square = false;

    // 10. Pause en arrière-plan : aucune demande tant que l'appli est cachée
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        document.querySelector('.d-shot-card[data-plan="P3"] [data-action="regen-plan"]').click();
    });
    await page.waitForTimeout(2500);
    check(calls.length === 13, 'appli en arrière-plan : génération en pause, aucun appel');
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitCalls(14);
    await idle();
    check(calls.length === 14, 'retour dans l\'appli : la génération reprend');

    // 11. Clé refusée
    sc.refuse = true;
    await card('P1').locator('[data-action="regen-plan"]').click();
    await waitToast(page, /Clé Agnes refusée/);
    await idle();
    check(/échec : Clé Agnes refusée/.test(await chip('P1')), 'clé refusée : message clair, plan marqué « ❌ échec »');
    sc.refuse = false;

    // 12. Arrêt pendant la génération
    sc.fail429 = 5;
    await card('P2').locator('[data-action="regen-plan"]').click();
    await page.waitForSelector('[data-action="stop-images"]');
    await page.waitForFunction(() => /nouvel essai/.test(document.querySelector('[data-chip="P2"]')?.textContent || ''));
    await page.click('[data-action="stop-images"]');
    await waitToast(page, /Génération arrêtée/);
    await idle();
    check(true, '« Arrêter la génération » interrompt l\'attente');
    sc.fail429 = 0;

    // 13. Export avec images → import : images reprises sans régénération
    const callsBeforeImport = calls.length;
    await page.evaluate(() => { document.getElementById('d-sec-backup').classList.add('open'); });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-full"]')]);
    const data = JSON.parse(await readFile(await dl.path(), 'utf8'));
    check(data.shots.length === 5 && data.assets.filter(a => a.kind === 'shot').length === 5 && data.shots.every(sh => sh.versions.length === 1),
        'export : l\'image retenue de chacun des 5 plans (sans les anciennes versions)');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-light"]')]);
    const light = JSON.parse(await readFile(await dl2.path(), 'utf8'));
    check(light.shots.length === 0 && !light.assets.some(a => a.kind === 'shot') && /sans-images/.test(dl2.suggestedFilename()), 'export léger : sans les images des plans');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#d-body-backup [data-action="import-project"]')]);
    await chooser.setFiles(await dl.path());
    await page.waitForFunction(() => document.querySelectorAll('#d-series option').length === 4);
    await page.waitForFunction(() => document.getElementById('d-badge-images')?.textContent === 'EP.1 · 5/5');
    check(calls.length === callsBeforeImport, 'série importée : « EP.1 · 5/5 », images reprises sans aucun appel');

    // 14. Supprimer l'épisode efface ses images
    await page.click('#d-body-script [data-action="delete-episode"]');
    await page.waitForFunction(() => /Créez un épisode/.test(document.getElementById('d-body-images').textContent));
    const left = await inApp(page, async ({ M, DB }) => {
        const pid = localStorage.getItem('drama_current_project');
        return { shots: (await DB.getByProject('shots', pid)).length, imgs: (await DB.getByProject('assets', pid)).filter(a => a.kind === 'shot').length };
    });
    check(left.shots === 0 && left.imgs === 0, 'épisode supprimé : ses images sont effacées du téléphone');

    await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: true }).catch(() => {});
    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
