// Étape 7 — rendu en lot avec reprise sur erreur, dans l'onglet Drama.
// EP.1 = l'épisode de 5 plans (images, voix, musique), EP.2 = 3 plans sans réplique.
// Reprise des plans déjà encodés, arrêt puis reprise, panne d'encodeur avec nouvel essai,
// appli fermée pendant le lot puis « Reprendre », MP4 assemblé relu.
// Lancer : node tests/drama/step7.batch.test.mjs
import { readFile } from 'node:fs/promises';
import { loadPlaywright, startServer, check, done, openDrama, inApp, waitToast, wav } from './helpers.mjs';
import { readMp4 } from './mp4.mjs';
import { SCRIPT_5_PLANS } from './fixtures.mjs';

const EP2 = `[PLAN] 1
[DECOR] Parking, aube
[IMAGE] Voiture garée sous la pluie
[CAM] zoom-in lent

[PLAN] 2
[IMAGE] Reflet dans une flaque
[CAM] fixe ; transition: fondu

[PLAN] 3
[IMAGE] La ville se réveille
[CAM] pan-droite ; transition: fondu au noir`;

const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

const COLORS = { P1: [220, 40, 40], P2: [40, 70, 220], P3: [40, 180, 70], P4: [230, 200, 40], P5: [200, 60, 200] };
const VOICE = { 'P2:0': 1.2, 'P3:0': 1.0, 'P4:0': 1.5 };
const close = (c, rgb, tol = 40) => c.every((v, i) => Math.abs(v - rgb[i]) <= tol);
const info = n => inApp(page, async ({ M }, n) => {
    const e = (await M.listEpisodes((await M.listProjects())[0].id)).find(x => x.number === n);
    return e.exportInfo;
}, n);
const setShot = (n, planId, rgb) => inApp(page, async ({ M, DB }, [n, planId, [r, g, b]]) => {
    const p = (await M.listProjects())[0];
    const e = (await M.listEpisodes(p.id)).find(x => x.number === n);
    const c = new OffscreenCanvas(1242, 2208), x = c.getContext('2d');
    x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(0, 0, 1242, 2208);
    const id = DB.newId('a');
    await DB.put('assets', { id, projectId: p.id, kind: 'shot', episodeId: e.id, planId, hash: 'h' + id, mime: 'image/jpeg', width: 1242, height: 2208, blob: await c.convertToBlob({ type: 'image/jpeg' }), createdAt: Date.now() });
    const sh = await DB.get('shots', e.id + ':' + planId);
    await DB.put('shots', { id: e.id + ':' + planId, projectId: p.id, episodeId: e.id, planId, versions: [...(sh ? sh.versions : []), id], current: id, hash: 'h' + id });
}, [n, planId, rgb]);
const segFiles = () => page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('drama-segments', { create: true });
    const names = [];
    for await (const [name] of dir.entries()) names.push(name);
    return names.sort();
});
const openSec = (...ks) => page.evaluate(ks => ks.forEach(k => document.getElementById('d-sec-' + k)?.classList.add('open')), ks);
const waitExportDone = () => page.waitForFunction(() => /✅ MP4/.test(document.getElementById('d-badge-export')?.textContent || ''), null, { timeout: 300000 });
const batchIdle = () => page.waitForSelector('#d-body-batch [data-action="batch-start"]', { timeout: 300000 });

try {
    console.log('Étape 7 — rendu en lot avec reprise (EP.1 de 5 plans + EP.2)');
    await page.goto(url + '/atelier/');
    await inApp(page, async ({ M, DB }, { script, script2, colors, voice, wavs }) => {
        const VO = await import('./drama/js/voices.js');
        const toBlob = (b64, type) => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type });
        const shot = async (p, e, planId, [r, g, b]) => {
            const c = new OffscreenCanvas(1242, 2208), x = c.getContext('2d');
            x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(0, 0, 1242, 2208);
            const id = DB.newId('a');
            await DB.put('assets', { id, projectId: p.id, kind: 'shot', episodeId: e.id, planId, hash: 'h' + id, mime: 'image/jpeg', width: 1242, height: 2208, blob: await c.convertToBlob({ type: 'image/jpeg' }), createdAt: Date.now() });
            await DB.put('shots', { id: e.id + ':' + planId, projectId: p.id, episodeId: e.id, planId, versions: [id], current: id, hash: 'h' + id });
        };
        const p = await M.createProject({ name: 'Néons Brisés' });
        await M.saveCharacter(p.id, { name: 'Lina', voice: { voiceId: 'voice_lina' } });
        await M.saveCharacter(p.id, { name: 'Marc', voice: { voiceId: 'voice_marc' } });
        const e1 = await M.saveEpisodeScript((await M.createEpisode(p.id, { title: 'La promesse' })).id, script);
        const e2 = await M.saveEpisodeScript((await M.createEpisode(p.id, { title: 'Le lendemain' })).id, script2);
        for (const [planId, rgb] of Object.entries(colors)) await shot(p, e1, planId, rgb);
        for (const [planId, rgb] of Object.entries({ P1: [90, 90, 90], P2: [20, 140, 160], P3: [240, 120, 30] })) await shot(p, e2, planId, rgb);
        const chars = await M.listCharacters(p.id);
        for (const line of VO.episodeLines(e1.analysis)) {
            const req = VO.buildVoiceRequest(p, chars, line);
            const id = DB.newId('a');
            await DB.put('assets', { id, projectId: p.id, kind: 'voice', episodeId: e1.id, lineId: line.id, hash: req.hash, mime: 'audio/wav', duration: voice[line.id], words: null, blob: toBlob(wavs[line.id], 'audio/wav'), createdAt: Date.now() });
            await DB.put('takes', { id: e1.id + ':' + line.id, projectId: p.id, episodeId: e1.id, lineId: line.id, planId: line.planId, versions: [id], current: id, hash: req.hash });
        }
        await M.saveLibrarySound(p.id, 'music', 'tension', new File([toBlob(wavs.music, 'audio/wav')], 'tension.wav', { type: 'audio/wav' }), 2);
        localStorage.setItem('drama_current_episode:' + p.id, e1.id);
        localStorage.setItem('drama_open_sections', JSON.stringify({ style: false, chars: false, episodes: true, script: false, images: false, voices: false, montage: false, export: true, batch: true }));
    }, { script: SCRIPT_5_PLANS, script2: EP2, colors: COLORS, voice: VOICE, wavs: {
        ...Object.fromEntries(Object.entries(VOICE).map(([k, d]) => [k, wav(d, 880).toString('base64')])), music: wav(2, 220).toString('base64') } });
    await openDrama(page, url);
    await page.waitForSelector('#d-sec-batch.open #d-body-batch .d-brow');
    check(await page.locator('#d-body-batch .d-brow').count() === 2, 'section « Rendu en lot » : les 2 épisodes de la série');

    // 1. Premier export de EP.1 : tout est encodé, un morceau par plan est gardé
    await page.click('[data-action="start-export"]');
    await waitExportDone();
    let i1 = await info(1);
    check(i1.encoded === 342 && i1.reused === 0, 'premier export EP.1 : 342 images encodées');
    check((await segFiles()).length === 5, '5 morceaux gardés (un par plan)');

    // 2. Petite modification : seuls les plans touchés sont réencodés
    await inApp(page, async ({ M }) => { const p = (await M.listProjects())[0]; await M.updateProject(p.id, { montage: { subSize: 'L' } }); });
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    await page.click('[data-action="start-export"]');
    await waitToast(page, /150 images reprises/);
    await waitExportDone();
    i1 = await info(1);
    check(i1.encoded === 192 && i1.reused === 150, 'sous-titres agrandis : 192 images réencodées (P2-P4), 150 reprises (P1, P5)');

    // le MP4 assemblé à partir de morceaux de deux exports différents se lit correctement
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="save-export"]')]);
    const mp4 = readMp4(await readFile(await dl.path()));
    const vt = mp4.tracks.find(t => t.handler === 'vide');
    check(vt.samples === 342 && Math.abs(vt.seconds - 11.4) < 0.05 && vt.width === 1080, 'MP4 assemblé : 342 images, 11,4 s, 1080×1920');
    const dec = await page.evaluate(async () => {
        const M = await import('./drama/js/model.js');
        const EX = await import('./drama/js/export.js');
        const e = (await M.listEpisodes((await M.listProjects())[0].id))[0];
        const v = document.createElement('video'); v.muted = true;
        v.src = URL.createObjectURL(await EX.getExportFile(e.exportInfo.file));
        await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('lecture impossible')); });
        const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const x = c.getContext('2d');
        const at = async t => { await new Promise(r => { v.onseeked = r; v.currentTime = t; }); x.drawImage(v, 0, 0); return [...x.getImageData(540, 700, 1, 1).data].slice(0, 3); };
        return { a: await at(1.0), b: await at(3.3), c: await at(10.8) };
    });
    check(close(dec.a, COLORS.P1) && close(dec.b, COLORS.P2) && close(dec.c, COLORS.P5), 'lecture : P1 (morceau repris), P2 (réencodé), P5 (repris) aux bons moments');

    // 3. Arrêt en cours d'export puis reprise : le travail fait n'est pas perdu
    await inApp(page, async ({ M }) => { const p = (await M.listProjects())[0]; await M.updateProject(p.id, { montage: { subtitles: false } }); });
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    await page.click('[data-action="start-export"]');
    await page.waitForFunction(() => { const m = /Image (\d+)\/342/.exec(document.getElementById('d-xtext')?.textContent || ''); return m && +m[1] > 200; }, null, { timeout: 120000 });
    await page.click('[data-action="stop-export"]');
    await waitToast(page, /relancez pour reprendre/);
    check(!(await info(1)), 'export arrêté (P2 et P3 déjà réencodés, P4 en cours)');
    await page.click('[data-action="start-export"]');
    await waitExportDone();
    i1 = await info(1);
    check(i1.encoded === 72 && i1.reused === 270, 'relance : seul P4 (72 images) est encodé, 270 reprises');

    // 4. Lot : EP.1 (déjà à jour) + EP.2
    await openSec('batch');
    await page.waitForFunction(() => /MP4 à jour/.test(document.querySelector('#d-body-batch .d-brow')?.textContent || ''));
    const checked = await page.$$eval('#d-body-batch input[data-bsel]', l => l.map(x => x.checked));
    check(JSON.stringify(checked) === '[false,true]', 'présélection : EP.2 (pas encore exporté), pas EP.1 (à jour)');
    await page.check('#d-body-batch input[data-bsel]:not(:checked)');
    await page.waitForFunction(() => /Exporter 2 épisodes/.test(document.querySelector('#d-body-batch [data-action="batch-start"]')?.textContent || ''));
    await page.click('#d-body-batch [data-action="batch-start"]');
    await waitToast(page, /Lot terminé : 2 épisodes exportés/);
    await batchIdle();
    const i2 = await info(2);
    check((await info(1)).encoded === 0 && (await info(1)).reused === 342, 'lot : EP.1 entièrement repris (0 image encodée)');
    check(i2 && i2.encoded === 225 && i2.duration === 7.5, 'lot : EP.2 exporté (3 plans sans réplique × 2,5 s = 225 images)');
    check(/2\/2 faits/.test(await page.textContent('#d-badge-batch')) && (await page.locator('#d-body-batch .d-chip:has-text("✅ exporté")').count()) === 2, 'résultat : « 2/2 faits », 2 × « ✅ exporté »');

    // 5. Panne d'encodeur : nouvel essai automatique qui reprend les plans déjà faits
    await setShot(2, 'P2', [200, 30, 120]);
    await setShot(2, 'P3', [30, 200, 220]);
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    await page.evaluate(() => {
        const orig = VideoEncoder.prototype.encode;
        let n = 0;
        VideoEncoder.prototype.encode = function (f, o) { if (++n === 120) throw new Error('panne simulée de l\'encodeur'); return orig.call(this, f, o); };
    });
    await openSec('batch');
    await page.waitForSelector('#d-body-batch input[data-bsel]');
    await page.click('#d-body-batch [data-action="batch-start"]');
    await waitToast(page, /Lot terminé : 1 épisode exporté/);
    await batchIdle();
    const res = await page.evaluate(() => JSON.parse(localStorage.getItem('drama_batch')));
    const r2 = Object.values(res.results)[0];
    check(r2.state === 'done' && r2.attempt === 2, 'panne au 1er essai : réussite au 2e essai automatique');
    check(r2.reused >= 75, '2e essai : les plans encodés avant la panne sont repris (' + r2.reused + ' images)');

    // 6. Appli fermée pendant le lot, puis « Reprendre »
    await page.reload();     // encodeur normal
    await page.waitForSelector('#drama-root[data-ready="1"]');
    await inApp(page, async ({ M }) => { const p = (await M.listProjects())[0]; await M.updateProject(p.id, { montage: { subtitles: true, subSize: 'S' } }); });
    await setShot(2, 'P1', [10, 10, 120]);
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    await openSec('batch');
    await page.waitForSelector('#d-body-batch input[data-bsel]');
    await page.$$eval('#d-body-batch input[data-bsel]', l => l.forEach(x => { if (!x.checked) x.click(); }));
    await page.waitForFunction(() => /Exporter 2 épisodes/.test(document.querySelector('#d-body-batch [data-action="batch-start"]')?.textContent || ''));
    await page.click('#d-body-batch [data-action="batch-start"]');
    await page.waitForFunction(() => { const m = /Épisode 1\/2.*Image (\d+)\/342/.exec(document.getElementById('d-btext')?.textContent || ''); return m && +m[1] > 140; }, null, { timeout: 120000 });
    await page.reload();     // l'appli est fermée en plein rendu
    await page.waitForSelector('#drama-root[data-ready="1"]');
    await openSec('batch');
    await page.waitForSelector('#d-body-batch [data-action="batch-resume"]');
    check(/interrompu/.test(await page.textContent('#d-badge-batch')) && /0\/2 épisodes fait/.test(await page.textContent('#d-body-batch .lock-banner')), 'au retour : « ⏸ Rendu en lot interrompu : 0/2 épisodes faits »');
    await page.click('[data-action="batch-resume"]');
    await waitToast(page, /Lot terminé : 2 épisodes exportés/);
    await batchIdle();
    const ra = await info(1), rb = await info(2);
    check(ra.reused >= 150 + 63 && ra.encoded <= 129, 'reprise EP.1 : les plans encodés avant la fermeture sont repris (' + ra.reused + ' reprises, ' + ra.encoded + ' encodées)');
    check(rb.encoded === 150 && rb.reused === 75, 'EP.2 : P1 changé (et P2 qui commence par un fondu depuis P1) refaits, P3 repris');
    check(!(await page.evaluate(() => JSON.parse(localStorage.getItem('drama_batch')).active)), 'lot terminé : plus de reprise en attente');

    // 7. Suppression d'un épisode : ses morceaux sont effacés
    await page.click('#drama-root .d-ep:has-text("Le lendemain")');
    await page.waitForFunction(() => document.getElementById('d-ep-number')?.value === '2');
    await page.click('#d-body-script [data-action="delete-episode"]');
    await page.waitForFunction(() => document.querySelectorAll('#d-body-batch .d-brow').length === 1);
    const files = await segFiles();
    const recs = await inApp(page, async ({ DB }) => (await DB.getAll('renders')).length);
    check(files.length === 5 && recs === 5, 'EP.2 supprimé : ses 3 morceaux effacés, ceux de EP.1 gardés');

    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
