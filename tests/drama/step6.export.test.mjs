// Étape 6 — export MP4 1080×1920 30 i/s avec le son, et vignette EP.x, sur l'épisode de 5 plans.
// Le fichier produit est relu de deux façons : structure MP4 (tests/drama/mp4.mjs) et lecture
// réelle dans le navigateur (images décodées, son décodé).
// Lancer : node tests/drama/step6.export.test.mjs
import { readFile } from 'node:fs/promises';
import { loadPlaywright, startServer, check, done, openDrama, inApp, waitToast, wav } from './helpers.mjs';
import { readMp4 } from './mp4.mjs';
import { SCRIPT_5_PLANS } from './fixtures.mjs';

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
const badge = () => page.textContent('#d-badge-export');
const progress = () => page.evaluate(() => document.getElementById('d-xtext')?.textContent || '');

try {
    console.log('Étape 6 — export MP4 et vignette (test sur 5 plans)');
    await page.goto(url + '/atelier/');
    await inApp(page, async ({ M, DB }, { script, colors, voice, wavs }) => {
        const VO = await import('./drama/js/voices.js');
        const toBlob = (b64, type) => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type });
        const p = await M.createProject({ name: 'Néons Brisés' });
        await M.saveCharacter(p.id, { name: 'Lina', voice: { voiceId: 'voice_lina' } });
        await M.saveCharacter(p.id, { name: 'Marc', voice: { voiceId: 'voice_marc' } });
        const e = await M.saveEpisodeScript((await M.createEpisode(p.id, { title: 'La promesse' })).id, script);
        for (const [planId, [r, g, b]] of Object.entries(colors)) {
            const c = new OffscreenCanvas(1242, 2208), x = c.getContext('2d');
            x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(0, 0, 1242, 2208);
            const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
            const id = DB.newId('a');
            await DB.put('assets', { id, projectId: p.id, kind: 'shot', episodeId: e.id, planId, hash: 'h' + planId, mime: 'image/jpeg', width: 1242, height: 2208, blob, createdAt: Date.now() });
            await DB.put('shots', { id: e.id + ':' + planId, projectId: p.id, episodeId: e.id, planId, versions: [id], current: id, hash: 'h' + planId });
        }
        const chars = await M.listCharacters(p.id);
        for (const line of VO.episodeLines(e.analysis)) {
            const req = VO.buildVoiceRequest(p, chars, line);
            const id = DB.newId('a');
            await DB.put('assets', { id, projectId: p.id, kind: 'voice', episodeId: e.id, lineId: line.id, hash: req.hash, mime: 'audio/wav', duration: voice[line.id], words: null, blob: toBlob(wavs[line.id], 'audio/wav'), createdAt: Date.now() });
            await DB.put('takes', { id: e.id + ':' + line.id, projectId: p.id, episodeId: e.id, lineId: line.id, planId: line.planId, versions: [id], current: id, hash: req.hash });
        }
        await M.saveLibrarySound(p.id, 'music', 'tension', new File([toBlob(wavs.music, 'audio/wav')], 'tension.wav', { type: 'audio/wav' }), 2);
        await M.saveLibrarySound(p.id, 'sfx', 'tonnerre', new File([toBlob(wavs.thunder, 'audio/wav')], 'tonnerre.wav', { type: 'audio/wav' }), 0.6);
        await M.saveLibrarySound(p.id, 'sfx', 'porte-claque', new File([toBlob(wavs.clap, 'audio/wav')], 'porte.wav', { type: 'audio/wav' }), 0.3);
        localStorage.setItem('drama_open_sections', JSON.stringify({ style: false, chars: false, episodes: true, script: false, images: false, voices: false, montage: false, export: true }));
    }, { script: SCRIPT_5_PLANS, colors: COLORS, voice: VOICE, wavs: {
        ...Object.fromEntries(Object.entries(VOICE).map(([k, d]) => [k, wav(d, 880).toString('base64')])),
        music: wav(2, 220).toString('base64'), thunder: wav(0.6, 90).toString('base64'), clap: wav(0.3, 1500).toString('base64') } });
    await openDrama(page, url);
    await page.waitForSelector('#d-sec-export.open [data-action="start-export"]');
    const fmt = await page.textContent('#d-body-export .wake-status');
    check(/Format : (H\.264 \+ AAC|VP9 \+ Opus|AV1 \+ Opus)/.test(fmt), 'format choisi selon l\'appareil : ' + fmt.match(/Format : [^—]+/)[0].trim());
    check(await badge() === 'EP.1' && !(await page.$('#d-body-export .d-export')), 'avant export : pas de fichier');

    // 1. Export complet
    const t0 = Date.now();
    await page.click('[data-action="start-export"]');
    await page.waitForSelector('#d-xfill');
    await page.waitForFunction(() => /Image \d+\/342/.test(document.getElementById('d-xtext')?.textContent || ''), null, { timeout: 60000 });
    check(true, 'progression affichée : « Image n/342 » (11,4 s × 30 i/s)');
    await page.waitForFunction(() => /✅ MP4/.test(document.getElementById('d-badge-export')?.textContent || ''), null, { timeout: 400000 });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    check(true, 'export terminé en ' + secs + ' s (badge « EP.1 · ✅ MP4 »)');
    check(/neons-brises-ep1\.mp4/.test(await page.textContent('#d-body-export .d-export')) && /✅ à jour/.test(await page.textContent('#d-body-export .d-export')), 'fichier « neons-brises-ep1.mp4 », à jour');
    check(/📤 MP4/.test(await page.textContent('#drama-root .d-ep')), 'liste des épisodes : « 📤 MP4 »');

    // 2. Le fichier enregistré sur le téléphone
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="save-export"]')]);
    const buf = await readFile(await dl.path());
    const mp4 = readMp4(buf);
    const vt = mp4.tracks.find(t => t.handler === 'vide'), at = mp4.tracks.find(t => t.handler === 'soun');
    check(dl.suggestedFilename() === 'neons-brises-ep1.mp4' && mp4.ok, 'MP4 valide enregistré : ' + dl.suggestedFilename() + ' (' + (buf.length / 1e6).toFixed(2) + ' Mo)');
    check(vt && vt.width === 1080 && vt.height === 1920 && ['avc1', 'vp09', 'av01'].includes(vt.codec), 'piste vidéo 1080×1920 (' + (vt && vt.codec) + ')');
    check(vt && vt.samples === 342 && Math.abs(vt.seconds - 11.4) < 0.05, 'vidéo : 342 images = 11,4 s à 30 i/s');
    check(at && at.channels === 2 && at.sampleRate === 48000 && ['mp4a', 'Opus'].includes(at.codec) && Math.abs(at.seconds - 11.4) < 0.1,
        'piste audio stéréo 48 kHz (' + (at && at.codec) + '), ' + (at && at.seconds.toFixed(2)) + ' s');

    // 3. Relecture réelle : images et son décodés
    const decoded = await page.evaluate(async () => {
        const M = await import('./drama/js/model.js');
        const EX = await import('./drama/js/export.js');
        const e = (await M.listEpisodes((await M.listProjects())[0].id))[0];
        const file = await EX.getExportFile(e.exportInfo.file);
        const v = document.createElement('video');
        v.muted = true; v.src = URL.createObjectURL(file);
        await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('lecture impossible')); });
        const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
        const x = c.getContext('2d');
        const at = async t => {
            await new Promise(r => { v.onseeked = r; v.currentTime = t; });
            x.drawImage(v, 0, 0, 1080, 1920);
            const px = [...x.getImageData(540, 700, 1, 1).data].slice(0, 3);
            const band = x.getImageData(40, 1500, 1000, 200).data;
            let white = 0;
            for (let i = 0; i < band.length; i += 4) if (band[i] > 225 && band[i + 1] > 225 && band[i + 2] > 225) white++;
            return { px, white };
        };
        const out = { w: v.videoWidth, h: v.videoHeight, d: v.duration, f1: await at(1.0), f3: await at(3.3), f5: await at(9.15), f6: await at(10.8) };
        const ac = new OfflineAudioContext(1, 1, 48000);
        try {
            const buf = await ac.decodeAudioData(await file.arrayBuffer());
            const d = buf.getChannelData(0), sr = buf.sampleRate;
            const rms = (a, b) => { let s = 0, n = 0; for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / n); };
            out.audio = { duration: buf.duration, voice: rms(3.1, 3.9), musicOnly: rms(1.2, 2.3), end: rms(10, 11) };
        } catch (err) { out.audio = { error: err.message }; }
        return out;
    });
    check(decoded.w === 1080 && decoded.h === 1920 && Math.abs(decoded.d - 11.4) < 0.1, 'le MP4 se lit : 1080×1920, ' + decoded.d.toFixed(2) + ' s');
    check(close(decoded.f1.px, COLORS.P1) && decoded.f1.white < 100, 'à 1,0 s : image de P1, sans sous-titre');
    check(close(decoded.f3.px, COLORS.P2) && decoded.f3.white > 1000, 'à 3,3 s : image de P2 et sous-titre incrusté (' + decoded.f3.white + ' pixels blancs)');
    check(decoded.f5.px.every(v => v < 45), 'à 9,15 s : fondu au noir ' + JSON.stringify(decoded.f5.px));
    check(close(decoded.f6.px, COLORS.P5), 'à 10,8 s : image de P5');
    const au = decoded.audio;
    check(!au.error && au.voice > au.musicOnly * 1.5 && au.musicOnly > 0.01 && au.end < 0.01,
        'son décodé : voix + musique baissée pendant P2, musique seule pendant P1, silence à la fin ' + JSON.stringify(au));

    // 4. Montage modifié : export « à refaire »
    await inApp(page, async ({ M }) => { const p = (await M.listProjects())[0]; await M.updateProject(p.id, { montage: { subSize: 'L' } }); });
    await page.reload();
    await page.waitForSelector('#drama-root[data-ready="1"]');
    check(/à refaire/.test(await badge()) && /montage modifié/.test(await page.textContent('#d-body-export .d-export')), 'taille des sous-titres changée : export signalé « à refaire »');

    // 5. Vignette EP.1 sur le plan P3
    await page.selectOption('#d-thumb-plan', 'P3');
    await page.click('[data-action="make-thumb"]');
    await waitToast(page, /Vignette EP\.1 créée/);
    const thumb = await inApp(page, async ({ M }) => {
        const e = (await M.listEpisodes((await M.listProjects())[0].id))[0];
        const a = await M.getAsset(e.thumb.assetId);
        const bmp = await createImageBitmap(a.blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
        x.drawImage(bmp, 0, 0);
        const band = x.getImageData(100, 1420, 880, 300).data;
        let white = 0;
        for (let i = 0; i < band.length; i += 4) if (band[i] > 230 && band[i + 1] > 230 && band[i + 2] > 230) white++;
        return { w: bmp.width, h: bmp.height, mime: a.mime, plan: e.thumb.planId, top: [...x.getImageData(540, 300, 1, 1).data].slice(0, 3), white };
    });
    check(thumb.w === 1080 && thumb.h === 1920 && thumb.mime === 'image/jpeg' && thumb.plan === 'P3', 'vignette JPEG 1080×1920 tirée de P3');
    check(close(thumb.top, COLORS.P3) && thumb.white > 5000, 'image de P3 en haut, texte « EP.1 » et titre en bas (' + thumb.white + ' pixels blancs)');
    const [dlt] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="save-thumb"]')]);
    check(dlt.suggestedFilename() === 'neons-brises-ep1-vignette.jpg', 'vignette enregistrée : ' + dlt.suggestedFilename());
    if (process.env.OUT) { await dlt.saveAs(process.env.OUT + '/vignette.jpg'); await dl.saveAs(process.env.OUT + '/ep1.mp4'); }

    // 6. Pause en arrière-plan puis arrêt
    await page.click('[data-action="start-export"]');
    await page.waitForFunction(() => /Image \d{2,}\//.test(document.getElementById('d-xtext')?.textContent || ''), null, { timeout: 60000 });
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1000);
    const p1 = await progress();
    await page.waitForTimeout(2500);
    const p2 = await progress();
    check(p1 === p2, 'appli en arrière-plan : export en pause (' + p1.match(/Image \d+\/342/)[0] + ')');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(p => (document.getElementById('d-xtext')?.textContent || '') !== p, p2, { timeout: 30000 });
    check(true, 'retour dans l\'appli : l\'export reprend');
    await page.click('[data-action="stop-export"]');
    await waitToast(page, /Export arrêté/);
    const after = await inApp(page, async ({ M }) => {
        const EX = await import('./drama/js/export.js');
        const e = (await M.listEpisodes((await M.listProjects())[0].id))[0];
        return { info: e.exportInfo, file: !!(await EX.getExportFile(e.id + '.mp4')) };
    });
    check(after.info === null && !after.file, 'export arrêté : aucun fichier incomplet gardé');

    // 7. Suppression de l'épisode : vignette effacée
    await page.evaluate(() => { document.getElementById('d-sec-script').classList.add('open'); });
    await page.click('#d-body-script [data-action="delete-episode"]');
    await page.waitForFunction(() => /Créez un épisode/.test(document.getElementById('d-body-export').textContent));
    const thumbs = await inApp(page, async ({ DB }) => (await DB.getAll('assets')).filter(a => a.kind === 'thumb').length);
    check(thumbs === 0, 'épisode supprimé : sa vignette est effacée');

    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
} finally {
    await browser.close();
    server.close();
    done();
}
