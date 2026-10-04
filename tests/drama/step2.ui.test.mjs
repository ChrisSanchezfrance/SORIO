// Étape 2 — analyse du script dans l'écran épisode (5 plans).
// Lancer : node tests/drama/step2.ui.test.mjs
import { readFile } from 'node:fs/promises';
import { loadPlaywright, startServer, check, done } from './helpers.mjs';
import { SCRIPT_5_PLANS } from './fixtures.mjs';

const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const model = fn => page.evaluate(fn);

try {
    console.log('Étape 2 — analyse dans l\'appli (test sur 5 plans)');
    await page.goto(url + '/atelier/drama/');
    await page.waitForSelector('#new-name');

    // Série + 2 personnages (créés par le modèle de l'étape 1)
    const { pid, eid } = await model(async () => {
        const M = await import('./js/model.js');
        const p = await M.createProject({ name: 'Néons Brisés' });
        await M.saveCharacter(p.id, { name: 'Lina', voice: { voiceId: 'voice_lina' } });
        await M.saveCharacter(p.id, { name: 'Marc', voice: { voiceId: 'voice_marc' } });
        const e = await M.createEpisode(p.id, { title: 'La promesse' });
        return { pid: p.id, eid: e.id };
    });
    await page.goto(url + '/atelier/drama/#/p/' + pid + '/e/' + eid);
    await page.waitForSelector('#ep-script');
    check(/Script vide/.test(await page.textContent('#analysis')), 'épisode vide : « Script vide »');

    // Saisie du script de 5 plans
    await page.locator('#ep-script').click();
    await page.keyboard.insertText(SCRIPT_5_PLANS);
    await page.waitForFunction(() => /5 plans prêts/.test(document.querySelector('#analysis .an-head')?.textContent || ''));
    check(true, 'analyse en direct : « ✅ 5 plans prêts »');
    check(await page.locator('.plan-card').count() === 5, '5 cartes de plan affichées');
    const stats = await page.textContent('.an-stats');
    check(/3 répliques · 2 sons · 2 personnages · durée estimée ~12 s/.test(stats) && /Musiques à importer : tension/.test(stats), 'résumé : ' + stats.replace(/\s+/g, ' ').trim());
    const p2 = await page.locator('.plan-card').nth(1).textContent();
    check(/P2/.test(p2) && /pan ←/.test(p2) && /fondu 0.5 s/.test(p2) && /@Marc.*Lina, attends !/.test(p2) && /porte-claque à 0.2 s/.test(p2), 'carte P2 : caméra, transition, réplique, son');
    check(/2.5 s \(défaut\)/.test(await page.locator('.plan-card').nth(0).textContent()), 'carte P1 : 2,5 s (défaut)');

    // JSON enregistré avec l'épisode
    const stored = await model(async () => {
        const M = await import('./js/model.js');
        const pid = location.hash.split('/')[2], eid = location.hash.split('/')[4];
        const e = (await M.listEpisodes(pid)).find(x => x.id === eid);
        return { status: e.status, ok: e.analysis.ok, n: e.analysis.plans.length, ids: e.analysis.plans.map(p => p.id), script: e.script };
    });
    check(stored.status === 'prêt' && stored.ok && stored.n === 5 && stored.ids.join() === 'P1,P2,P3,P4,P5' && stored.script === SCRIPT_5_PLANS,
        'IndexedDB : script + liste des 5 plans JSON, statut « prêt »');

    // Erreur introduite ligne 5 → message cliquable qui sélectionne la ligne
    await page.evaluate(() => {
        const ta = document.getElementById('ep-script');
        ta.value = ta.value.replace('[CAM] zoom-in lent', '[CAM] zoom-inn lent');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForSelector('.issue.error');
    const issue = await page.textContent('.issue.error');
    check(/L\.5/.test(issue) && /vouliez-vous « zoom-in »/.test(issue), 'erreur affichée : ' + issue.trim());
    await page.click('.issue.error');
    const sel = await page.evaluate(() => { const t = document.getElementById('ep-script'); return t.value.slice(t.selectionStart, t.selectionEnd); });
    check(sel === '[CAM] zoom-inn lent', 'toucher l\'erreur sélectionne la ligne 5 du script');
    check(await model(async () => {
        const M = await import('./js/model.js');
        const pid = location.hash.split('/')[2];
        return (await M.listEpisodes(pid))[0].status;
    }) === 'à corriger', 'statut « à corriger » enregistré');

    // Correction → de nouveau prêt
    await page.evaluate(() => {
        const ta = document.getElementById('ep-script');
        ta.value = ta.value.replace('zoom-inn lent', 'zoom-in lent');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => /5 plans prêts/.test(document.querySelector('#analysis .an-head')?.textContent || ''));
    check(true, 'après correction : de nouveau « 5 plans prêts »');

    // Téléchargement du JSON
    await page.click('.json-box summary');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="download-json"]')]);
    const json = JSON.parse(await readFile(await dl.path(), 'utf8'));
    check(dl.suggestedFilename() === 'ep1-plans.json' && json.episode === 1 && json.plans.length === 5 && json.ok, 'JSON téléchargé : ep1-plans.json (5 plans)');

    // Liste des épisodes
    await page.click('.panel .back-link');
    await page.waitForSelector('[data-action="new-episode"]');
    const card = await page.textContent('.card:has-text("La promesse")');
    check(/5 plans · ✅ prêt · ~12 s/.test(card), 'liste des épisodes : « 5 plans · ✅ prêt · ~12 s »');

    // Fiche renommée → script ré-analysé (Marc n'existe plus)
    await model(async () => {
        const M = await import('./js/model.js');
        const pid = location.hash.split('/')[2];
        const marc = (await M.listCharacters(pid)).find(c => c.name === 'Marc');
        await M.saveCharacter(pid, { id: marc.id, name: 'Marco' });
    });
    await page.reload();
    await page.waitForSelector('[data-action="new-episode"]');
    const card2 = await page.textContent('.card:has-text("La promesse")');
    check(/❌ \d+ erreurs?/.test(card2), 'fiche @Marc renommée : épisode repassé « à corriger » (' + card2.match(/❌ \d+ erreurs?/)[0] + ')');
    await page.click('.card:has-text("La promesse")');
    await page.waitForSelector('.issue.error');
    check(/@Marc inconnu.*vouliez-vous @Marco/.test(await page.textContent('.issues')), 'message : « @Marc inconnu — vouliez-vous @Marco ? »');

    await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: true }).catch(() => {});
    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
