// Étape 5 — montage dans l'onglet Drama : bibliothèque sonore, aperçu image par image
// (pixels vérifiés) et mixage réel (rendu audio hors ligne), sur l'épisode de 5 plans.
// Lancer : node tests/drama/step5.preview.test.mjs
import { loadPlaywright, startServer, check, done, openDrama, inApp, waitToast, wav } from './helpers.mjs';
import { SCRIPT_5_PLANS } from './fixtures.mjs';

const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

const COLORS = { P1: [220, 40, 40], P2: [40, 70, 220], P3: [40, 180, 70], P4: [230, 200, 40], P5: [200, 60, 200] };
const VOICE = { 'P2:0': 1.2, 'P3:0': 1.0, 'P4:0': 1.5 };

// Pixels de l'aperçu à l'instant t (canvas 540×960)
async function frameAt(t) {
    await page.evaluate(t => { const s = document.getElementById('d-seek'); s.value = t; s.dispatchEvent(new Event('input', { bubbles: true })); }, t);
    await page.waitForTimeout(250);   // chargement des images voisines puis nouveau dessin
    await page.evaluate(t => { const s = document.getElementById('d-seek'); s.value = t; s.dispatchEvent(new Event('input', { bubbles: true })); }, t);
    return page.evaluate(() => {
        const c = document.getElementById('d-canvas'), x = c.getContext('2d');
        const px = (X, Y) => [...x.getImageData(X, Y, 1, 1).data].slice(0, 3);
        const band = x.getImageData(20, 760, 500, 100).data;   // zone des sous-titres
        let white = 0;
        for (let i = 0; i < band.length; i += 4) if (band[i] > 235 && band[i + 1] > 235 && band[i + 2] > 235) white++;
        return { center: px(270, 400), edge: px(15, 400), white };
    });
}
const close = (c, rgb, tol = 30) => c.every((v, i) => Math.abs(v - rgb[i]) <= tol);
const seekTo = t => frameAt(t);

try {
    console.log('Étape 5 — montage : aperçu et mixage (test sur 5 plans)');
    await page.goto(url + '/atelier/');
    // Épisode prêt : images (couleur unie + cadre blanc), prises de voix à jour
    await inApp(page, async ({ M, IMG, DB }, { script, colors, voice, voiceWav }) => {
        const VO = await import('./drama/js/voices.js');
        const p = await M.createProject({ name: 'Néons Brisés' });
        await M.saveCharacter(p.id, { name: 'Lina', voice: { voiceId: 'voice_lina' } });
        await M.saveCharacter(p.id, { name: 'Marc', voice: { voiceId: 'voice_marc' } });
        const e = await M.saveEpisodeScript((await M.createEpisode(p.id, { title: 'La promesse' })).id, script);
        for (const [planId, [r, g, b]] of Object.entries(colors)) {
            const c = new OffscreenCanvas(1242, 2208), x = c.getContext('2d');
            x.fillStyle = '#fff'; x.fillRect(0, 0, 1242, 2208);
            x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(60, 60, 1122, 2088);
            const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
            const id = DB.newId('a');
            await DB.put('assets', { id, projectId: p.id, kind: 'shot', episodeId: e.id, planId, hash: 'h' + planId, mime: 'image/jpeg', width: 1242, height: 2208, blob, createdAt: Date.now() });
            await DB.put('shots', { id: e.id + ':' + planId, projectId: p.id, episodeId: e.id, planId, versions: [id], current: id, hash: 'h' + planId });
        }
        const chars = await M.listCharacters(p.id);
        for (const line of VO.episodeLines(e.analysis)) {
            const req = VO.buildVoiceRequest(p, chars, line);
            const bytes = Uint8Array.from(atob(voiceWav[line.id]), ch => ch.charCodeAt(0));
            const id = DB.newId('a');
            const words = line.texte.split(' ').map((w, i, all) => ({ w, s: i * voice[line.id] / all.length, e: (i + 1) * voice[line.id] / all.length }));
            await DB.put('assets', { id, projectId: p.id, kind: 'voice', episodeId: e.id, lineId: line.id, hash: req.hash, mime: 'audio/wav', duration: voice[line.id], words, blob: new Blob([bytes], { type: 'audio/wav' }), createdAt: Date.now() });
            await DB.put('takes', { id: e.id + ':' + line.id, projectId: p.id, episodeId: e.id, lineId: line.id, planId: line.planId, versions: [id], current: id, hash: req.hash });
        }
        localStorage.setItem('drama_open_sections', JSON.stringify({ style: false, chars: false, episodes: false, script: false, images: false, voices: false, montage: true }));
    }, { script: SCRIPT_5_PLANS, colors: COLORS, voice: VOICE,
         voiceWav: Object.fromEntries(Object.entries(VOICE).map(([k, d]) => [k, wav(d, 880).toString('base64')])) });
    await openDrama(page, url);
    await page.waitForSelector('#d-sec-montage.open #d-canvas');
    check(await page.textContent('#d-badge-montage') === 'EP.1 · 0:11', 'section Montage : badge « EP.1 · 0:11 »');
    let summary = await page.textContent('#d-body-montage .queue-summary');
    check(/🖼️ 5\/5 · 🎙️ 3\/3 · 🎵 0\/1 · 🔊 0\/2/.test(summary), 'état : 5/5 images, 3/3 voix, musique et bruitages à importer');
    check(/2 bruitages à importer/.test(await page.textContent('#d-body-montage')), 'l\'aperçu reste possible, manques signalés');

    // Bibliothèque sonore : import par le sélecteur de fichiers
    const imp = async (name, buffer) => {
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'),
            page.click('[data-action="lib-import"][data-name="' + name + '"]')]);
        await chooser.setFiles({ name: name + '.wav', mimeType: 'audio/wav', buffer });
        await waitToast(page, new RegExp('« ' + name + ' » importé'));
        await page.waitForSelector('#d-sec-montage #d-canvas');
    };
    await imp('tension', wav(2, 220));
    await imp('porte-claque', wav(0.3, 1500));
    await imp('tonnerre', wav(0.6, 90));
    summary = await page.textContent('#d-body-montage .queue-summary');
    check(/🎵 1\/1 · 🔊 2\/2/.test(summary) && await page.locator('#d-body-montage .d-sound').count() === 3, 'musique et 2 bruitages importés (✅ dans la bibliothèque)');
    check(/✅ tension\.wav · 0:02\.0/.test(await page.textContent('#d-body-montage .d-sound:has-text("tension")')), 'durée du fichier lue : 2,0 s');

    // Aperçu image par image
    let f = await seekTo(1.0);
    check(close(f.center, COLORS.P1) && f.white < 50, 't = 1,0 s : image de P1, pas de sous-titre');
    const e0 = await seekTo(0.02), e1 = await seekTo(2.45);
    // cadre blanc de 60 px sur 1242 (≈ 26 px dans l'aperçu) : un zoom de 7 % rogne ≈ 19 px de chaque côté
    check(close(e0.edge, [255, 255, 255], 25) && close(e1.edge, COLORS.P1), 'P1 « zoom-in lent » : à 15 px du bord, le cadre blanc du début est sorti de l\'image à la fin');
    f = await seekTo(2.75);
    const half = COLORS.P1.map((v, i) => (v + COLORS.P2[i]) / 2);
    check(close(f.center, half, 20) && !close(f.center, COLORS.P1) && !close(f.center, COLORS.P2),
        'P2 « fondu » (milieu de la transition) : moitié P1, moitié P2 ' + JSON.stringify(f.center));
    f = await seekTo(3.3);
    check(close(f.center, COLORS.P2) && f.white > 300, 't = 3,3 s : P2 et sous-titre « Lina, attends ! » (' + f.white + ' pixels blancs)');
    f = await seekTo(9.15);
    check(f.center.every(v => v < 40), 'P5 « fondu au noir » (milieu) : image noire ' + JSON.stringify(f.center));
    f = await seekTo(10.5);
    check(close(f.center, COLORS.P5), 'après le fondu : image de P5');
    check(/P5/.test(await page.textContent('#d-plan-label')), 'nom du plan affiché sous l\'aperçu');

    // Réglages : sous-titres désactivés, puis grande taille
    await page.selectOption('#d-sub-on', '0');
    await page.waitForFunction(() => document.getElementById('d-sub-on')?.value === '0' && document.getElementById('d-canvas'));
    f = await seekTo(3.3);
    check(f.white < 50, 'sous-titres désactivés : plus de texte à l\'image');
    await page.selectOption('#d-sub-on', '1');
    await page.waitForFunction(() => document.getElementById('d-sub-on')?.value === '1');
    const mid = (await seekTo(3.3)).white;
    await page.selectOption('#d-sub-size', 'L');
    await page.waitForFunction(() => document.getElementById('d-sub-size')?.value === 'L');
    const big = (await seekTo(3.3)).white;
    check(big > mid * 1.2, 'taille « Grande » : sous-titre plus gros (' + mid + ' → ' + big + ' pixels)');
    const saved = await inApp(page, async ({ M }) => (await M.listProjects())[0].montage);
    check(saved.subtitles === true && saved.subSize === 'L', 'réglages du montage enregistrés pour la série');

    // Lecture en temps réel
    await seekTo(0);
    await page.click('#d-preview-btn');
    await page.waitForFunction(() => /Pause/.test(document.getElementById('d-preview-btn').textContent), null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    const pos = await page.evaluate(() => parseFloat(document.getElementById('d-seek').value));
    check(pos > 0.6 && pos < 2.5, 'lecture : l\'aperçu avance en temps réel (' + pos.toFixed(2) + ' s après ~1,2 s)');
    await page.click('#d-preview-btn');
    await page.waitForFunction(() => /Lire/.test(document.getElementById('d-preview-btn').textContent));
    check(true, 'pause');

    // Mixage réel, rendu hors ligne (même code que l'aperçu et l'export)
    const audio = await page.evaluate(async () => {
        const M = await import('./drama/js/model.js');
        const PL = await import('./drama/js/player.js');
        const MX = await import('./drama/js/mix.js');
        const p = (await M.listProjects())[0];
        const e = (await M.listEpisodes(p.id))[0];
        const tl = await PL.loadEpisodeTimeline(p, await M.listCharacters(p.id), e);
        const sr = 8000;
        const render = async gains => {
            const ac = new OfflineAudioContext(1, Math.ceil(tl.duration * sr), sr);
            const buffers = new Map();
            for (const id of MX.soundAssetIds(tl)) buffers.set(id, await ac.decodeAudioData(await (await M.getAsset(id)).blob.arrayBuffer()));
            MX.scheduleMix(ac, ac.destination, tl, buffers, { offset: 0, when: 0, ...gains });
            return (await ac.startRendering()).getChannelData(0);
        };
        const rms = (d, a, b) => { let s = 0, n = 0; for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / n); };
        const music = await render({ voiceGain: 0, sfxGain: 0 });
        const voices = await render({ musicGain: 0, sfxGain: 0 });
        const sfx = await render({ voiceGain: 0, musicGain: 0 });
        return {
            duration: tl.duration, duck: tl.settings.duck,
            musicFree: rms(music, 1.2, 2.4), musicUnderVoice: rms(music, 3.1, 3.9), musicAfterStop: rms(music, 9.5, 11),
            voiceIn: rms(voices, 3.0, 3.9), voiceOut: rms(voices, 0.5, 2.5),
            clap: rms(sfx, 2.72, 2.95), clapBefore: rms(sfx, 1.5, 2.6), thunder: rms(sfx, 8.95, 9.4)
        };
    });
    const ratio = audio.musicUnderVoice / audio.musicFree;
    check(audio.musicFree > 0.05 && Math.abs(ratio - audio.duck) < 0.06, 'musique baissée sous la voix : ' + Math.round(ratio * 100) + ' % de son niveau (réglage ' + Math.round(audio.duck * 100) + ' %)');
    check(audio.musicAfterStop < 0.005, '[MUSIQUE] stop en P5 : plus de musique après 8,9 s');
    check(audio.voiceIn > 0.05 && audio.voiceOut < 0.005, 'voix de Marc entendue dans P2, silence pendant P1');
    check(audio.clap > 0.05 && audio.clapBefore < 0.005 && audio.thunder > 0.05, 'bruitages à leur moment : porte-claque à 2,7 s, tonnerre à 8,9 s');

    // Remplacer puis retirer un son
    await imp('tension', wav(3, 330));
    const lib = await inApp(page, async ({ M }) => (await M.listLibrary((await M.listProjects())[0].id)).map(a => a.name + ':' + a.duration));
    check(lib.filter(x => x.startsWith('tension')).join() === 'tension:3', 'importer à nouveau « tension » remplace l\'ancien fichier');
    await page.click('.d-sound:has-text("porte-claque") [data-action="lib-delete"]');
    await page.waitForFunction(() => /🔊 1\/2/.test(document.querySelector('#d-body-montage .queue-summary')?.textContent || ''));
    check(true, 'bruitage retiré : de nouveau « à importer »');

    if (process.env.SHOT) { await seekTo(3.3); await page.locator('#d-sec-montage').screenshot({ path: process.env.SHOT }); }
    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
