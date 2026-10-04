// Étape 4 — doublage ElevenLabs (API simulée) dans l'onglet Drama, sur l'épisode de 5 plans.
// Génération, durées des plans issues de l'audio, cache, autre prise, versions, erreurs, pause,
// écoute de l'épisode, export/import.
// Lancer : node tests/drama/step4.voices.test.mjs
import { readFile } from 'node:fs/promises';
import { loadPlaywright, startServer, check, done, openDrama, inApp, waitToast } from './helpers.mjs';
import { SCRIPT_5_PLANS } from './fixtures.mjs';

// Audio WAV de `seconds` secondes (la « prise » renvoyée par l'API simulée).
function wav(seconds, rate = 22050) {
    const n = Math.round(seconds * rate);
    const buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 220) * 8000), 44 + i * 2);
    return buf;
}
const DURATIONS = { 'Lina, attends !': 1.2, "Tu m'as menti.": 1.0, 'Je voulais te protéger.': 1.5 };
function alignment(text, seconds) {
    const chars = [...text], step = seconds / chars.length;
    return { characters: chars, character_start_times_seconds: chars.map((_, i) => +(i * step).toFixed(3)),
        character_end_times_seconds: chars.map((_, i) => +((i + 1) * step).toFixed(3)) };
}

const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

const calls = [];
const sc = { fail429: 0, quota: false };
await ctx.route('https://api.elevenlabs.io/v1/text-to-speech/**', r => {
    const req = r.request();
    const body = JSON.parse(req.postData());
    calls.push({ url: req.url(), key: req.headers()['xi-api-key'], body });
    if (sc.quota) return r.fulfill({ status: 401, json: { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } } });
    if (sc.fail429 > 0) { sc.fail429--; return r.fulfill({ status: 429, json: { detail: { status: 'too_many_concurrent_requests', message: 'busy' } } }); }
    const seconds = DURATIONS[body.text] || 0.8;
    return r.fulfill({ json: { audio_base64: wav(seconds).toString('base64'), alignment: alignment(body.text, seconds) } });
});

const badge = () => page.textContent('#d-badge-voices');
const chip = id => page.textContent('[data-vchip="' + id + '"]');
const line = id => page.locator('#drama-root .d-line[data-line="' + id + '"]');
const idle = () => page.waitForSelector('#drama-root [data-action="gen-voices"]', { timeout: 60000 });
async function waitCalls(n, timeout = 30000) {
    const t0 = Date.now();
    while (calls.length < n) { if (Date.now() - t0 > timeout) throw new Error('attendu ' + n + ' appels, reçu ' + calls.length); await page.waitForTimeout(100); }
}
const timing = () => inApp(page, async ({ M }) => {
    const VO = await import('./drama/js/voices.js');
    const p = (await M.listProjects()).find(x => x.id === localStorage.getItem('drama_current_project'));
    const e = (await M.listEpisodes(p.id))[0];
    const { states, timing } = await VO.voiceStates(p, await M.listCharacters(p.id), e);
    return { states: states.map(s => s.line.id + ':' + s.state), durations: timing.plans.map(x => x.duration), total: timing.total, complete: timing.complete };
});
const editScript = (from, to) => page.evaluate(([from, to]) => {
    const ta = document.getElementById('d-script');
    ta.value = ta.value.replace(from, to);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}, [from, to]);

try {
    console.log('Étape 4 — doublage ElevenLabs (test sur 5 plans)');
    await page.goto(url + '/atelier/');
    await inApp(page, async ({ M }, script) => {
        const p = await M.createProject({ name: 'Néons Brisés' });
        await M.saveCharacter(p.id, { name: 'Lina', voice: { voiceId: 'voice_lina', voiceName: 'Lina FR', stability: 0.4 } });
        await M.saveCharacter(p.id, { name: 'Marc', voice: { voiceId: 'voice_marc', voiceName: 'Marc FR', speed: 1.1 } });
        const e = await M.createEpisode(p.id, { title: 'La promesse' });
        await M.saveEpisodeScript(e.id, script);
        localStorage.setItem('drama_elevenlabs_key', 'el-test-key');
    }, SCRIPT_5_PLANS);
    await openDrama(page, url);
    await page.waitForSelector('#d-sec-voices.open [data-action="gen-voices"]');
    check(await badge() === 'EP.1 · 0/3' && /Générer les 3 répliques/.test(await page.textContent('[data-action="gen-voices"]')), 'section Voix : « EP.1 · 0/3 », bouton « Générer les 3 répliques »');
    check(/Épisode : 0:1\d \(estimation\)/.test(await page.textContent('#d-body-voices .queue-summary')), 'durée de l\'épisode estimée avant doublage');

    // 1. Doublage des 3 répliques
    await page.click('[data-action="gen-voices"]');
    await idle();
    await page.waitForFunction(() => document.getElementById('d-badge-voices').textContent === 'EP.1 · 3/3');
    check(calls.length === 3, '3 appels à ElevenLabs pour 3 répliques');
    const c0 = calls[0];
    check(/\/v1\/text-to-speech\/voice_marc\/with-timestamps\?output_format=mp3_44100_128$/.test(c0.url) && c0.key === 'el-test-key',
        'requête : voix de Marc, horodatage, MP3, clé ElevenLabs');
    check(c0.body.text === 'Lina, attends !' && c0.body.model_id === 'eleven_multilingual_v2' && c0.body.voice_settings.speed === 1.1 &&
        c0.body.voice_settings.similarity_boost === 0.75 && calls[1].body.voice_settings.stability === 0.4, 'texte, modèle et réglages de chaque fiche envoyés');
    let tm = await timing();
    check(tm.complete && JSON.stringify(tm.durations) === '[2.5,2.1,1.9,2.4,2.5]' && tm.total === 11.4,
        'durées des plans = durées des voix (+ marges) : 2,5 / 2,1 / 1,9 / 2,4 / 2,5 s, total 11,4 s');
    check(/Épisode : 0:11/.test(await page.textContent('#d-body-voices .queue-summary')) && /1\.2 s/.test(await line('P2:0').textContent()), 'affichage : épisode 0:11, réplique de P2 1,2 s');
    const stored = await inApp(page, async ({ DB }) => (await DB.getAll('assets')).filter(a => a.kind === 'voice').map(a => [a.mime, a.duration, a.words.length]));
    check(stored.length === 3 && stored.every(([m, d, w]) => m === 'audio/mpeg' && d > 0.9 && w >= 3), 'prises gardées sur le téléphone avec durée et mots horodatés');
    check(/🎙️ 3\/3/.test(await page.textContent('#drama-root .d-ep')), 'liste des épisodes : « 🎙️ 3/3 »');

    // 2. Cache
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    check(await badge() === 'EP.1 · 3/3' && await page.isDisabled('[data-action="gen-voices"]') && calls.length === 3, 'après rechargement : 3/3, rien à refaire, aucun appel');

    // 3. Autre prise pour une réplique, puis retour à la première
    await line('P3:0').locator('[data-action="regen-line"]').click();
    await waitCalls(4);
    await idle();
    await page.waitForFunction(() => /v2\/2/.test(document.querySelector('.d-line[data-line="P3:0"]')?.textContent || ''));
    check(calls.length === 4 && calls[3].body.text === "Tu m'as menti.", '« Autre prise » sur P3 : 1 seul appel, version 2/2');
    await line('P3:0').locator('[data-action="take-version"][data-dir="-1"]').click();
    await page.waitForFunction(() => /v1\/2/.test(document.querySelector('.d-line[data-line="P3:0"]')?.textContent || ''));
    check(/prête/.test(await chip('P3:0')), '◀ : retour à la première prise, toujours prête');

    // 4. Texte modifié puis remis : une prise refaite, puis reprise du cache
    await editScript('Je voulais te protéger.', 'Je voulais seulement te protéger.');
    await page.waitForFunction(() => document.getElementById('d-badge-voices').textContent === 'EP.1 · 2/3');
    check(/à refaire/.test(await chip('P4:0')), 'réplique de P4 modifiée : « à refaire »');
    await page.click('[data-action="gen-voices"]');
    await waitCalls(5);
    await idle();
    check(calls[4].body.text === 'Je voulais seulement te protéger.' && (await timing()).durations[3] === 1.7, 'seule P4 est doublée (0,8 s de voix → plan de 1,7 s)');
    await editScript('Je voulais seulement te protéger.', 'Je voulais te protéger.');
    await page.waitForFunction(() => /en cache/.test(document.querySelector('[data-vchip="P4:0"]')?.textContent || ''));
    await page.click('[data-action="gen-voices"]');
    await waitToast(page, /reprise du cache/);
    await page.waitForFunction(() => document.getElementById('d-badge-voices').textContent === 'EP.1 · 3/3');
    check(calls.length === 5 && (await timing()).total === 11.4, 'texte d\'origine remis : prise reprise du cache, aucun appel, 11,4 s');

    // 5. Réglage de voix modifié dans la fiche : seules ses répliques sont à refaire
    await inApp(page, async ({ M }) => {
        const pid = localStorage.getItem('drama_current_project');
        const marc = (await M.listCharacters(pid)).find(c => c.name === 'Marc');
        await M.saveCharacter(pid, { id: marc.id, voice: { speed: 1 } });
    });
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    tm = await timing();
    check(tm.states.join() === 'P2:0:stale,P3:0:ok,P4:0:stale', 'vitesse de Marc modifiée : ses 2 répliques à refaire, Lina inchangée');
    await page.click('[data-action="gen-voices"]');
    await waitCalls(7);
    await idle();
    check(calls.slice(5).every(c => /voice_marc/.test(c.url) && c.body.voice_settings.speed === 1), '2 appels, uniquement pour Marc, nouvelle vitesse');

    // 6. Fiche sans voix : réplique bloquée, sans appel
    await inApp(page, async ({ M }) => {
        const pid = localStorage.getItem('drama_current_project');
        const lina = (await M.listCharacters(pid)).find(c => c.name === 'Lina');
        await M.saveCharacter(pid, { id: lina.id, voice: { voiceId: '', voiceName: '' } });
    });
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    check(/Choisissez une voix pour @Lina/.test(await page.textContent('#d-body-voices .lock-banner')) && /Choisissez une voix/.test(await chip('P3:0')),
        'fiche sans voix : message « Choisissez une voix pour @Lina »');
    check(await page.isDisabled('[data-action="gen-voices"]') && calls.length === 7, 'rien à générer tant que la voix manque');
    await inApp(page, async ({ M }) => {
        const pid = localStorage.getItem('drama_current_project');
        const lina = (await M.listCharacters(pid)).find(c => c.name === 'Lina');
        await M.saveCharacter(pid, { id: lina.id, voice: { voiceId: 'voice_lina', voiceName: 'Lina FR' } });
    });
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');

    // 7. 429 puis réussite
    sc.fail429 = 1;
    await line('P2:0').locator('[data-action="regen-line"]').click();
    await page.waitForFunction(() => /nouvel essai/.test(document.querySelector('[data-vchip="P2:0"]')?.textContent || ''));
    check(true, 'ElevenLabs répond 429 : « ⏸ nouvel essai dans … s »');
    await waitCalls(9, 30000);
    await idle();
    check(calls.length === 9, 'après l\'attente, nouvel essai réussi');

    // 8. Crédits épuisés
    sc.quota = true;
    await line('P2:0').locator('[data-action="regen-line"]').click();
    await waitToast(page, /Crédits ElevenLabs épuisés/);
    await idle();
    check(/Crédits ElevenLabs épuisés/.test(await chip('P2:0')), 'crédits épuisés : message clair sur la réplique');
    sc.quota = false;

    // 9. Pause en arrière-plan
    const n0 = calls.length;
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        document.querySelector('.d-line[data-line="P4:0"] [data-action="regen-line"]').click();
    });
    await page.waitForTimeout(2500);
    check(calls.length === n0, 'appli en arrière-plan : doublage en pause, aucun appel');
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitCalls(n0 + 1);
    await idle();
    check(true, 'retour dans l\'appli : le doublage reprend');

    // 10. Écoute de l'épisode
    await page.click('[data-action="play-episode"]');
    await page.waitForSelector('[data-action="stop-play"]');
    await page.waitForFunction(() => /0:0\d \/ 0:1\d/.test(document.getElementById('d-play-clock')?.textContent || ''));
    check(true, '« Écouter l\'épisode » : lecture avec compteur (position / durée totale)');
    await page.click('[data-action="stop-play"]');
    await page.waitForSelector('[data-action="play-episode"]');
    check(true, 'arrêt de l\'écoute');

    // 11. Export / import : prises reprises sans appel
    const nBefore = calls.length;
    await page.evaluate(() => { document.getElementById('d-sec-backup').classList.add('open'); });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-full"]')]);
    const data = JSON.parse(await readFile(await dl.path(), 'utf8'));
    check(data.takes.length === 3 && data.takes.every(t => t.versions.length === 1) && data.assets.filter(a => a.kind === 'voice').length === 3,
        'export : la prise retenue de chacune des 3 répliques');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#d-body-backup [data-action="import-project"]')]);
    await chooser.setFiles(await dl.path());
    await page.waitForFunction(() => document.querySelectorAll('#d-series option').length === 4);
    await page.waitForFunction(() => document.getElementById('d-badge-voices')?.textContent === 'EP.1 · 3/3');
    check(calls.length === nBefore, 'série importée : « EP.1 · 3/3 » sans aucun appel');

    // 12. Suppression de l'épisode : prises effacées
    await page.click('#d-body-script [data-action="delete-episode"]');
    await page.waitForFunction(() => /Créez un épisode/.test(document.getElementById('d-body-voices').textContent));
    const left = await inApp(page, async ({ DB }) => {
        const pid = localStorage.getItem('drama_current_project');
        return { takes: (await DB.getByProject('takes', pid)).length, voices: (await DB.getByProject('assets', pid)).filter(a => a.kind === 'voice').length };
    });
    check(left.takes === 0 && left.voices === 0, 'épisode supprimé : ses prises de voix sont effacées');

    await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: true }).catch(() => {});
    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
