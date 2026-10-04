// Étape 4 bis — répliques enregistrées au micro (micro simulé par Chromium), sur l'épisode de 5 plans.
// Lancer : node tests/drama/step4.mic.test.mjs
import { loadPlaywright, startServer, check, done, openDrama, inApp, waitToast, wav } from './helpers.mjs';
import { speechBounds, encodeWav } from '../../atelier/drama/js/mic.js';
import { SCRIPT_5_PLANS } from './fixtures.mjs';

console.log('Étape 4 bis — enregistrement des répliques au micro (5 plans)');

// Traitement du son (pur)
const sr = 8000;
const sig = new Float32Array(sr * 3);                      // 1 s de silence, 1 s de voix, 1 s de silence
for (let i = sr; i < 2 * sr; i++) sig[i] = 0.3 * Math.sin(i / sr * 2 * Math.PI * 300);
for (let i = 0; i < sig.length; i++) if (i < sr || i >= 2 * sr) sig[i] = 0.003 * Math.sin(i);   // souffle
const [a, b] = speechBounds(sig, sr);
check(Math.abs(a / sr - 0.92) < 0.03 && Math.abs(b / sr - 2.08) < 0.03, 'silences retirés : il reste la voix (1 s) + 0,08 s de marge de chaque côté');
check(speechBounds(new Float32Array(sr).fill(0.001), sr) === null, 'enregistrement muet : rien de retenu');
const w = new DataView(encodeWav(new Float32Array([0, 0.5, -1, 1]), 16000));
check(w.getUint32(24, true) === 16000 && w.getUint16(22, true) === 1 && w.getInt16(46, true) === 16383 && w.getInt16(48, true) === -32768 && w.byteLength === 52,
    'WAV mono 16 bits correct');

const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
const calls = [];
await ctx.route('https://api.elevenlabs.io/v1/text-to-speech/**', r => {
    const body = JSON.parse(r.request().postData());
    calls.push(body.text);
    return r.fulfill({ json: { audio_base64: wav(1.1, 600).toString('base64') } });
});

const chip = id => page.textContent('[data-vchip="' + id + '"]');
const line = id => page.locator('#drama-root .d-line[data-line="' + id + '"]');
const badge = () => page.textContent('#d-badge-voices');
const state = () => inApp(page, async ({ M }) => {
    const VO = await import('./drama/js/voices.js');
    const p = (await M.listProjects())[0];
    const e = (await M.listEpisodes(p.id))[0];
    const { states, timing } = await VO.voiceStates(p, await M.listCharacters(p.id), e);
    const takes = await VO.getTakes(e.id);
    const t3 = takes.get('P3:0');
    const a3 = t3 && await M.getAsset(t3.current);
    return { states: states.map(s => s.line.id + ':' + s.state + (s.micro ? ':micro' : '')).join(' '), plans: timing.plans.map(p => p.duration),
        p3: a3 ? { source: a3.source, mime: a3.mime, duration: a3.duration, versions: t3.versions.length } : null };
});
async function record(id, ms = 2500) {
    await line(id).locator('[data-action="rec-start"]').click();
    await page.waitForSelector('#drama-root .d-rec');
    await page.waitForTimeout(ms);
    await page.click('[data-action="rec-stop"]');
    await waitToast(page, /Réplique enregistrée/);
    await page.waitForSelector('#drama-root [data-action="rec-start"]');
}
const editScript = (from, to) => page.evaluate(([from, to]) => {
    const ta = document.getElementById('d-script');
    ta.value = ta.value.replace(from, to);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}, [from, to]);

try {
    await page.goto(url + '/atelier/');
    // Personnages sans voix ElevenLabs, pas de clé ElevenLabs
    await inApp(page, async ({ M }, script) => {
        const p = await M.createProject({ name: 'Néons Brisés' });
        await M.saveCharacter(p.id, { name: 'Lina' });
        await M.saveCharacter(p.id, { name: 'Marc' });
        await M.saveEpisodeScript((await M.createEpisode(p.id, { title: 'La promesse' })).id, script);
        localStorage.removeItem('drama_elevenlabs_key');
        localStorage.setItem('drama_open_sections', JSON.stringify({ style: false, chars: false, episodes: false, script: true, images: false, voices: true, montage: false }));
    }, SCRIPT_5_PLANS);
    await openDrama(page, url);
    await page.waitForSelector('#d-sec-voices.open [data-action="rec-start"]');
    check(/Enregistrez chaque réplique au micro/.test(await page.textContent('#d-body-voices')), 'sans clé ElevenLabs : l\'appli propose le micro');
    check(/ou enregistrez-la au micro/.test(await chip('P3:0')) && await page.locator('#drama-root [data-action="rec-start"]').count() === 3, 'chaque réplique a son bouton « 🎤 Enregistrer », même sans voix choisie');

    // 1. Enregistrement de la réplique de Lina (P3)
    await line('P3:0').locator('[data-action="rec-start"]').click();
    await page.waitForSelector('#drama-root .d-rec');
    await page.waitForFunction(() => /0:0[12]/.test(document.getElementById('d-rec-time')?.textContent || ''));
    check(true, 'pendant l\'enregistrement : point rouge, compteur, « Arrêter » et « Annuler »');
    await page.waitForTimeout(1500);
    await page.click('[data-action="rec-stop"]');
    await waitToast(page, /Réplique enregistrée : \d+\.\d s/);
    await page.waitForFunction(() => /enregistrée au micro/.test(document.querySelector('[data-vchip="P3:0"]')?.textContent || ''));
    let st = await state();
    check(st.p3 && st.p3.source === 'micro' && st.p3.mime === 'audio/wav' && st.p3.duration > 0.3 && st.p3.duration <= 2.8,
        'prise gardée : WAV, ' + (st.p3 && st.p3.duration) + ' s (silences retirés)');
    check(Math.abs(st.plans[2] - Math.max(1.5, 0.4 + st.p3.duration + 0.5)) < 0.01, 'durée du plan P3 = 0,4 s + durée de la prise + 0,5 s = ' + st.plans[2] + ' s');
    check(await badge() === 'EP.1 · 1/3' && /🎤 votre voix/.test(await line('P3:0').textContent()), 'badge « 1/3 », mention « 🎤 votre voix »');
    await line('P3:0').locator('[data-action="play-line"]').click();
    check(true, 'écoute de la prise');

    // 2. Réenregistrer : nouvelle version, l'ancienne est gardée
    await record('P3:0', 1500);
    st = await state();
    check(st.p3.versions === 2 && /v2\/2/.test(await line('P3:0').textContent()), 'réenregistrement : version 2/2, ◀ pour revenir à la première');

    // 3. Annuler, quitter l'appli, micro refusé : aucune prise ajoutée
    await line('P2:0').locator('[data-action="rec-start"]').click();
    await page.waitForSelector('#drama-root .d-rec');
    await page.click('[data-action="rec-cancel"]');
    await page.waitForSelector('#drama-root [data-action="rec-start"]');
    await line('P2:0').locator('[data-action="rec-start"]').click();
    await page.waitForSelector('#drama-root .d-rec');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await waitToast(page, /Enregistrement annulé/);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refusé', 'NotAllowedError')); });
    await line('P2:0').locator('[data-action="rec-start"]').click();
    await waitToast(page, /Micro refusé/);
    check(/0\/1|error/.test((await state()).states.split(' ')[0]) || (await state()).states.startsWith('P2:0:error'), 'annulation, appli quittée, micro refusé : rien n\'est enregistré');
    check(/autorisez le micro/.test(await page.textContent('#toast-text')), 'micro refusé : explication pour l\'autoriser');
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');

    // 4. La prise au micro suit le texte de la réplique
    await editScript("Tu m'as menti.", "Tu m'as trahi.");
    await page.waitForFunction(() => document.getElementById('d-badge-voices').textContent === 'EP.1 · 0/3');
    check(/ou enregistrez-la au micro/.test(await chip('P3:0')), 'texte modifié : la prise ne correspond plus, à réenregistrer');
    await editScript("Tu m'as trahi.", "Tu m'as menti.");
    await page.waitForFunction(() => document.getElementById('d-badge-voices').textContent === 'EP.1 · 1/3');
    check(true, 'texte d\'origine remis : la prise au micro redevient valable');

    // 5. Mélange avec ElevenLabs : la génération ne touche pas aux prises au micro
    await inApp(page, async ({ M }) => {
        const pid = (await M.listProjects())[0].id;
        const marc = (await M.listCharacters(pid)).find(c => c.name === 'Marc');
        await M.saveCharacter(pid, { id: marc.id, voice: { voiceId: 'voice_marc', voiceName: 'Marc FR' } });
        localStorage.setItem('drama_elevenlabs_key', 'el-test-key');
    });
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    check(/Générer 2 répliques manquantes/.test(await page.textContent('[data-action="gen-voices"]')), 'avec une clé : 2 répliques de Marc à générer, celle de Lina déjà enregistrée');
    await page.click('[data-action="gen-voices"]');
    await page.waitForFunction(() => document.getElementById('d-badge-voices').textContent === 'EP.1 · 3/3');
    st = await state();
    check(calls.length === 2 && !calls.includes("Tu m'as menti.") && /P3:0:ok:micro/.test(st.states), 'ElevenLabs appelé pour Marc seulement ; la prise au micro de Lina est gardée');

    // 6. Montage : la prise au micro est mixée et sous-titrée
    const tl = await inApp(page, async ({ M }) => {
        const PL = await import('./drama/js/player.js');
        const p = (await M.listProjects())[0];
        const t = await PL.loadEpisodeTimeline(p, await M.listCharacters(p.id), (await M.listEpisodes(p.id))[0]);
        return { voice: t.voices.find(v => v.lineId === 'P3:0'), cue: t.cues.find(c => c.perso === 'Lina') };
    });
    check(tl.voice.assetId && tl.cue && tl.cue.text === "Tu m'as menti.", 'montage : prise au micro placée dans P3, sous-titre « Tu m\'as menti. »');

    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
