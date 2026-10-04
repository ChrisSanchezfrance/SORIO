// Onglet « 🎞️ Vidéos » — non-régression après l'ajout des onglets (API vidéo Agnes simulée).
// Création d'une vidéo au format YouTube 16:9, galerie, bibliothèque, pause en arrière-plan.
// Lancer : node tests/atelier/videos.test.mjs
import { loadPlaywright, startServer, check, done } from '../drama/helpers.mjs';

const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

const creations = [];
let polls = 0;
await ctx.route('https://apihub.agnes-ai.com/**', r => {
    const u = r.request().url();
    if (u.includes('/v1/videos')) {
        creations.push(JSON.parse(r.request().postData()));
        return r.fulfill({ json: { video_id: 'vid-' + creations.length } });
    }
    polls++;
    return r.fulfill({ json: { status: 'completed', progress: 100, metadata: { url: 'https://cdn.agnes.test/v.mp4' } } });
});
await ctx.route('https://cdn.agnes.test/**', r => r.fulfill({ body: Buffer.alloc(4096, 1), contentType: 'video/mp4' }));

try {
    console.log('Onglet Vidéos — non-régression');
    await page.goto(url + '/atelier/');
    check(await page.evaluate(() => document.body.dataset.tab) === 'video' && await page.isVisible('#upload-zone') && !(await page.isVisible('#drama-root')),
        'ouverture : onglet Vidéos, Drama masqué');
    await page.fill('#api-key-input', 'sk-test-video');
    await page.click('#api-save-btn');
    check(/Clé API active/.test(await page.textContent('#api-status-text')), 'clé Agnes enregistrée');
    await page.evaluate(() => localStorage.setItem('agnes_timing_cache_v10', JSON.stringify({ '153': [1000] })));

    // Format YouTube 16:9 puis une photo verticale
    await page.click('[data-toggle="section-format"]');
    await page.click('[data-format="youtube"]');
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 1000;
        const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 600, 1000); return c.toDataURL('image/png').split(',')[1]; });
    await page.setInputFiles('#file-input', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForSelector('#images-grid .image-card');
    check(/Créer 1 vidéo/.test(await page.textContent('#generate-btn')), 'photo ajoutée : « Créer 1 vidéo »');

    // Le passage par l'onglet Drama ne gêne pas l'onglet Vidéos
    await page.click('[data-app-tab="drama"]');
    await page.waitForSelector('#drama-root[data-ready="1"]');
    await page.click('[data-app-tab="video"]');
    await page.waitForSelector('#generate-btn', { state: 'visible' });
    check(await page.locator('#images-grid .image-card').count() === 1, 'aller-retour par l\'onglet Drama : la photo est toujours là');

    // Création + pause en arrière-plan pendant l'attente
    await page.click('#generate-btn');
    await page.waitForFunction(() => /se prépare/.test(document.getElementById('queue').textContent));
    const sent = creations[0];
    const dims = await page.evaluate(src => new Promise(r => { const i = new Image(); i.onload = () => r(i.width + 'x' + i.height); i.src = src; }), sent.image);
    check(dims === '1280x720' && /Landscape orientation 16:9/.test(sent.prompt) && sent.model === 'agnes-video-v2.0', 'image envoyée recadrée en 1280×720, prompt 16:9, modèle vidéo');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    const frozen = await page.textContent('#queue');
    await page.waitForTimeout(3000);
    check(await page.textContent('#queue') === frozen && polls === 0, 'appli en arrière-plan : compte à rebours figé, aucune interrogation');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForSelector('#gallery-grid .gallery-item', { timeout: 60000 });
    check(polls >= 1, 'retour dans l\'appli : la création reprend et se termine');
    await page.waitForSelector('#library-grid .library-item');
    check(/dans l'appli/.test(await page.textContent('#library-grid')), 'vidéo enregistrée dans « Mes vidéos enregistrées »');
    check(await page.evaluate(() => localStorage.getItem('atelier_pending_jobs_v1')) === '[]', 'aucune tâche en attente après la fin');

    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
