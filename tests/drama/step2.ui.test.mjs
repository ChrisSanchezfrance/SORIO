// Étape 2 — analyse du script dans la section « 📝 Script » de l'onglet Drama (5 plans).
// Lancer : node tests/drama/step2.ui.test.mjs
import { readFile } from 'node:fs/promises';
import { loadPlaywright, startServer, check, done, openDrama, inApp } from './helpers.mjs';
import { SCRIPT_5_PLANS } from './fixtures.mjs';

const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const head = () => page.textContent('#d-analysis .an-head');
const setScript = (from, to) => page.evaluate(([from, to]) => {
    const ta = document.getElementById('d-script');
    ta.value = ta.value.replace(from, to);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}, [from, to]);
const epStatus = () => inApp(page, async ({ M }) => (await M.listEpisodes((await M.listProjects())[0].id))[0].status);

try {
    console.log('Étape 2 — analyse du script dans l\'onglet Drama (test sur 5 plans)');
    await page.goto(url + '/atelier/');
    await inApp(page, async ({ M }) => {
        const p = await M.createProject({ name: 'Néons Brisés' });
        await M.saveCharacter(p.id, { name: 'Lina', voice: { voiceId: 'voice_lina' } });
        await M.saveCharacter(p.id, { name: 'Marc', voice: { voiceId: 'voice_marc' } });
        await M.createEpisode(p.id, { title: 'La promesse' });
    });
    await openDrama(page, url);
    await page.waitForSelector('#d-script');
    check(/Script vide/.test(await head()) && await page.textContent('#d-badge-script') === 'EP.1 · vide', 'épisode vide : « Script vide », badge « EP.1 · vide »');

    // Saisie du script de 5 plans
    await page.locator('#d-script').click();
    await page.keyboard.insertText(SCRIPT_5_PLANS);
    await page.waitForFunction(() => /5 plans prêts/.test(document.querySelector('#d-analysis .an-head')?.textContent || ''));
    check(true, 'analyse en direct : « ✅ 5 plans prêts »');
    check(await page.textContent('#d-badge-script') === 'EP.1 · 5 plans', 'badge de la section : « EP.1 · 5 plans »');
    check(await page.locator('#d-analysis .plan-card').count() === 5, '5 cartes de plan affichées');
    const stats = await page.textContent('#d-analysis .an-stats');
    check(/3 répliques · 2 sons · 2 personnages · durée estimée ~12 s/.test(stats) && /Musiques à importer : tension/.test(stats), 'résumé : ' + stats.replace(/\s+/g, ' ').trim());
    const p2 = await page.locator('#d-analysis .plan-card').nth(1).textContent();
    check(/P2/.test(p2) && /pan ←/.test(p2) && /fondu 0.5 s/.test(p2) && /@Marc.*Lina, attends !/.test(p2) && /porte-claque à 0.2 s/.test(p2), 'carte P2 : caméra, transition, réplique, son');
    check(/2.5 s \(défaut\)/.test(await page.locator('#d-analysis .plan-card').nth(0).textContent()), 'carte P1 : 2,5 s (défaut)');

    // JSON enregistré avec l'épisode
    const stored = await inApp(page, async ({ M }) => {
        const e = (await M.listEpisodes((await M.listProjects())[0].id))[0];
        return { status: e.status, ok: e.analysis.ok, ids: e.analysis.plans.map(p => p.id).join(), script: e.script };
    });
    check(stored.status === 'prêt' && stored.ok && stored.ids === 'P1,P2,P3,P4,P5' && stored.script === SCRIPT_5_PLANS,
        'IndexedDB : script + liste des 5 plans JSON, statut « prêt »');

    // Erreur ligne 5 → message qui sélectionne la ligne
    await setScript('[CAM] zoom-in lent', '[CAM] zoom-inn lent');
    await page.waitForSelector('#d-analysis .issue.error');
    const issue = await page.textContent('#d-analysis .issue.error');
    check(/L\.5/.test(issue) && /vouliez-vous « zoom-in »/.test(issue), 'erreur affichée : ' + issue.trim());
    check(await page.textContent('#d-badge-script') === 'EP.1 · 1 erreur', 'badge de la section : « EP.1 · 1 erreur »');
    await page.click('#d-analysis .issue.error');
    const sel = await page.evaluate(() => { const t = document.getElementById('d-script'); return t.value.slice(t.selectionStart, t.selectionEnd); });
    check(sel === '[CAM] zoom-inn lent', 'toucher l\'erreur sélectionne la ligne 5 du script');
    check(await epStatus() === 'à corriger', 'statut « à corriger » enregistré');

    // Correction → de nouveau prêt
    await setScript('zoom-inn lent', 'zoom-in lent');
    await page.waitForFunction(() => /5 plans prêts/.test(document.querySelector('#d-analysis .an-head')?.textContent || ''));
    check(await epStatus() === 'prêt', 'après correction : « 5 plans prêts », statut « prêt »');

    // Téléchargement du JSON
    await page.click('#d-analysis .json-box summary');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="download-json"]')]);
    const json = JSON.parse(await readFile(await dl.path(), 'utf8'));
    check(dl.suggestedFilename() === 'ep1-plans.json' && json.episode === 1 && json.plans.length === 5 && json.ok, 'JSON téléchargé : ep1-plans.json (5 plans)');

    // Liste des épisodes
    await page.waitForFunction(() => /5 plans · ✅ prêt · ~12 s/.test(document.querySelector('#drama-root .d-ep')?.textContent || ''));
    check(true, 'liste des épisodes : « 5 plans · ✅ prêt · ~12 s »');

    // Fiche renommée → script ré-analysé (Marc n'existe plus)
    await inApp(page, async ({ M }) => {
        const pid = (await M.listProjects())[0].id;
        const marc = (await M.listCharacters(pid)).find(c => c.name === 'Marc');
        await M.saveCharacter(pid, { id: marc.id, name: 'Marco' });
    });
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    const card = await page.textContent('#drama-root .d-ep');
    check(/❌ 5 erreurs/.test(card), 'fiche @Marc renommée : épisode repassé « ❌ 5 erreurs »');
    check(/@Marc inconnu.*vouliez-vous @Marco/.test(await page.textContent('#d-analysis .issues')), 'message : « @Marc inconnu — vouliez-vous @Marco ? »');

    await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: true }).catch(() => {});
    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
