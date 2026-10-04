// Étape 8 — plans animés par Agnes (vidéo, API simulée) sur l'épisode de 5 plans :
// prompt avec la réplique, création espacée + suivi, clips dans l'aperçu et l'export,
// voix d'Agnes au choix par plan, reprise après fermeture, erreurs, versions, sauvegarde.
// Lancer : node tests/drama/step8.clips.test.mjs
import { readFile } from 'node:fs/promises';
import { loadPlaywright, startServer, check, done, openDrama, inApp, waitToast, wav } from './helpers.mjs';
import { SCRIPT_5_PLANS } from './fixtures.mjs';
import { parseScript } from '../../atelier/drama/js/parser.js';
import { buildClipRequest, pickFrames, defaultAnimate, MAX_CLIP_SECONDS } from '../../atelier/drama/js/clips.js';
import { computeTiming } from '../../atelier/drama/js/voices.js';

console.log('Étape 8 — plans animés par Agnes (test sur 5 plans)');

// ─── Partie pure : prompt, empreinte, longueur, minutage ──────────
const chars = [{ name: 'Lina', desc: 'Femme de 28 ans, carré noir' }, { name: 'Marc', desc: 'Homme de 30 ans, barbe courte' }];
const an = parseScript(SCRIPT_5_PLANS, chars);
const project = { style: { text: 'manhwa dramatique, néons', negative: 'texte, 3D' } };
const r2 = buildClipRequest(project, chars, an.plans[1], 'img-hash-1');
check(/Animate this exact image as the starting frame/.test(r2.prompt) && /clearly visible lip movements/.test(r2.prompt) &&
    r2.prompt.includes('Marc: "Lina, attends !"') && /Only the character who is speaking moves their lips/.test(r2.prompt),
    'prompt P2 : animer l\'image, Marc dit « Lina, attends ! » avec les lèvres, Lina se tait');
check(/Camera: camera pans slowly to the left\./.test(r2.prompt) && /Setting: Toit d'immeuble/.test(r2.prompt) && /natural voice with realistic lip sync/.test(r2.prompt),
    'caméra (pan-gauche), décor et son (voix avec synchronisation labiale)');
check(r2.negative.includes('texte, 3D') && /deformed face/.test(r2.negative), 'à éviter : style de la série + défauts courants');
const r4 = buildClipRequest(project, chars, an.plans[3], 'img-hash-1');
check(r4.prompt.includes('Marc (chuchoté): "Je voulais te protéger."'), 'le ton de la réplique est transmis (« chuchoté »)');
const r1 = buildClipRequest(project, chars, an.plans[0], 'img-hash-1');
check(/Nobody speaks: mouths stay closed/.test(r1.prompt) && /no dialogue/.test(r1.prompt), 'plan sans réplique : bouches fermées, pas de voix');
check(buildClipRequest(project, chars, an.plans[1], 'img-hash-2').hash !== r2.hash && buildClipRequest(project, chars, an.plans[1], 'img-hash-1').hash === r2.hash,
    'empreinte : change avec l\'image du plan, identique sinon');
check(buildClipRequest(project, chars, an.plans[1], null).error === 'Générez d\'abord l\'image du plan', 'pas d\'image : rien à animer');
check(pickFrames(2.5) === 121 && pickFrames(5.04) === 121 && pickFrames(5.5) === 153 && pickFrames(8) === 241 && pickFrames(14) === 241 && MAX_CLIP_SECONDS > 10,
    'longueur du clip : 5 s (121 images), 6,4 s (153), 10 s (241) selon la durée du plan');
check(an.plans.map(defaultAnimate).join() === 'false,true,true,true,false', 'animés par défaut : les plans avec une réplique (P2, P3, P4)');
const tm = computeTiming(an, { 'P2:0': 1.2, 'P3:0': 1, 'P4:0': 1.5 }, chars, { P3: 5.042 });
check(tm.plans[2].duration === 5.042 && tm.plans[2].mode === 'clip' && tm.plans[2].lines[0].agnes && tm.complete &&
    Math.abs(tm.plans[2].lines[0].start + tm.plans[2].lines[0].duration + 0.5 - 5.042) < 0.01,
    'voix d\'Agnes : durée du plan = durée du clip (5,04 s), réplique répartie dedans (sous-titre)');

// ─── Appli ────────────────────────────────────────────────────────
const { chromium } = loadPlaywright();
const { server, url } = await startServer();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

const COLORS = { P1: [220, 40, 40], P2: [40, 70, 220], P3: [40, 180, 70], P4: [230, 200, 40], P5: [200, 60, 200] };
const CLIP_A = [250, 140, 0], CLIP_B = [0, 200, 220];        // 1re moitié / 2e moitié de chaque clip
const VOICE = { 'P2:0': 1.2, 'P3:0': 1.0, 'P4:0': 1.5 };
const close = (c, rgb, tol = 45) => c.every((v, i) => Math.abs(v - rgb[i]) <= tol);

// API vidéo Agnes simulée
const creates = [], polls = [];
const sc = { fail429: 0, refuse: false, failIds: new Set(), hold: false, mute: false, cdnBlocked: false, content: true };
const contents = [];
const tasks = new Map();
let CLIP = null, CLIP_MUTE = null, nId = 0;
await ctx.route('https://apihub.agnes-ai.com/v1/videos', r => {
    const req = r.request();
    const body = JSON.parse(req.postData());
    creates.push({ body, at: Date.now(), auth: req.headers()['authorization'] });
    if (sc.refuse) return r.fulfill({ status: 401, json: { error: { message: 'invalid api key' } } });
    if (sc.fail429 > 0) { sc.fail429--; return r.fulfill({ status: 429, json: { error: { message: 'rate limited' } } }); }
    const id = 'vid' + (++nId);
    tasks.set(id, { polls: 0, mute: sc.mute });
    return r.fulfill({ json: { video_id: id, status: 'queued' } });
});
await ctx.route('https://apihub.agnes-ai.com/agnesapi**', r => {
    const u = new URL(r.request().url());
    const id = u.searchParams.get('video_id');
    polls.push({ id, model: u.searchParams.get('model_name') });
    const t = tasks.get(id);
    if (!t) return r.fulfill({ status: 404, json: { error: 'not found' } });
    t.polls++;
    if (sc.failIds.has(id)) return r.fulfill({ json: { status: 'failed', progress: 0 } });
    if (sc.hold || t.polls < 2) return r.fulfill({ json: { status: 'processing', progress: 40 } });
    return r.fulfill({ json: { status: 'completed', progress: 100, metadata: { url: 'https://cdn.agnes.test/' + id + '.mp4' } } });
});
await ctx.route('https://apihub.agnes-ai.com/v1/videos/*/content', r => {
    const id = r.request().url().match(/videos\/(vid\d+)\/content/)[1];
    contents.push({ id, auth: r.request().headers()['authorization'] });
    return sc.content ? r.fulfill({ body: CLIP, contentType: 'video/mp4' }) : r.fulfill({ status: 404, json: { error: 'not found' } });
});
await ctx.route('https://cdn.agnes.test/**', r => {
    if (sc.cdnBlocked) return r.abort('failed');      // hébergeur sans CORS : « Failed to fetch »
    const id = r.request().url().match(/(vid\d+)\.mp4/)[1];
    return r.fulfill({ body: tasks.get(id).mute ? CLIP_MUTE : CLIP, contentType: 'video/mp4' });
});

const FAST = { createEvery: 1, pollEvery: 0.3, estimate: 0.5, minFirstWait: 0.3, retryScale: 0.02 };
const fast = () => page.evaluate(async t => { const CL = await import('./drama/js/clips.js'); Object.assign(CL.CLIP_TIMING, t); }, FAST);
const reload = async () => { await page.reload(); await page.waitForSelector('#drama-root[data-ready="1"]'); await fast(); };
const badge = () => page.textContent('#d-badge-clips');
const chip = id => page.textContent('[data-cchip="' + id + '"]');
const idle = () => page.waitForSelector('#drama-root [data-action="gen-clips"]', { timeout: 60000 });
const state = () => inApp(page, async ({ M }) => {
    const CL = await import('./drama/js/clips.js');
    const PL = await import('./drama/js/player.js');
    const p = (await M.listProjects())[0];
    const ch = await M.listCharacters(p.id);
    const e = (await M.listEpisodes(p.id))[0];
    const st = await CL.clipStates(p, ch, e);
    const tl = await PL.loadEpisodeTimeline(p, ch, e);
    return {
        states: st.map(s => s.plan.id + ':' + s.state).join(' '),
        clips: Object.fromEntries(st.filter(s => s.asset).map(s => [s.plan.id, { ...s.asset, versions: s.clip.versions.length, pending: !!s.clip.pending }])),
        plans: tl.plans.map(x => ({ id: x.id, start: x.start, duration: x.duration, clip: !!x.clip })),
        clipAudio: tl.clipAudio, missingVoices: tl.missing.voices, ducks: tl.ducks.length,
        p3voice: tl.voices.find(v => v.lineId === 'P3:0'), cue3: tl.cues.find(c => c.text === "Tu m'as menti.")
    };
});
async function frameAt(t) {
    for (let k = 0; k < 2; k++) {
        await page.evaluate(t => { const s = document.getElementById('d-seek'); s.value = t; s.dispatchEvent(new Event('input', { bubbles: true })); }, t);
        await page.waitForTimeout(400);
    }
    return page.evaluate(() => [...document.getElementById('d-canvas').getContext('2d').getImageData(270, 400, 1, 1).data].slice(0, 3));
}

try {
    await page.goto(url + '/atelier/');
    // Clips de test (VP9 + Opus dans un MP4, 5,04 s à 24 i/s) fabriqués dans la page
    [CLIP, CLIP_MUTE] = (await page.evaluate(async ([a, b]) => {
        const { Muxer, ArrayBufferTarget } = await import('./drama/vendor/mp4-muxer.mjs');
        async function make(withAudio) {
            const W = 288, H = 512, N = 121;
            const target = new ArrayBufferTarget();
            const muxer = new Muxer({ target, video: { codec: 'vp9', width: W, height: H, frameRate: 24 },
                ...(withAudio ? { audio: { codec: 'opus', numberOfChannels: 2, sampleRate: 48000 } } : {}), fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
            const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { throw e; } });
            venc.configure({ codec: 'vp09.00.10.08', width: W, height: H, bitrate: 500000, framerate: 24 });
            const cv = new OffscreenCanvas(W, H), x = cv.getContext('2d');
            for (let i = 0; i < N; i++) {
                const c = i < N / 2 ? a : b;
                x.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; x.fillRect(0, 0, W, H);
                const f = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / 24), duration: Math.round(1e6 / 24) });
                venc.encode(f, { keyFrame: i % 24 === 0 }); f.close();
            }
            await venc.flush();
            if (withAudio) {
                const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { throw e; } });
                aenc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 64000 });
                const total = Math.round(48000 * N / 24);
                for (let i = 0; i < total; i += 960) {
                    const n = Math.min(960, total - i), d = new Float32Array(n * 2);
                    for (let j = 0; j < n; j++) d[j] = d[n + j] = 0.3 * Math.sin((i + j) / 48000 * 2 * Math.PI * 440);
                    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48 * 1000), data: d });
                    aenc.encode(ad); ad.close();
                }
                await aenc.flush();
            }
            muxer.finalize();
            const u8 = new Uint8Array(target.buffer);
            let s = '';
            for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            return btoa(s);
        }
        return [await make(true), await make(false)];
    }, [CLIP_A, CLIP_B])).map(b => Buffer.from(b, 'base64'));
    check(CLIP.length > 1000, 'clip de test fabriqué (' + (CLIP.length / 1e3).toFixed(0) + ' Ko, avec son) + version muette');

    // Épisode prêt : images des plans, prises de voix (micro), clé Agnes
    await inApp(page, async ({ M, DB }, { script, colors, voice, wavs }) => {
        const VO = await import('./drama/js/voices.js');
        const toBlob = (b64, type) => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type });
        const p = await M.createProject({ name: 'Néons Brisés', styleText: 'manhwa dramatique, néons' });
        await M.saveCharacter(p.id, { name: 'Lina', desc: 'Femme de 28 ans, carré noir' });
        await M.saveCharacter(p.id, { name: 'Marc', desc: 'Homme de 30 ans, barbe courte' });
        const e = await M.saveEpisodeScript((await M.createEpisode(p.id, { title: 'La promesse' })).id, script);
        for (const [planId, [r, g, b]] of Object.entries(colors)) {
            const c = new OffscreenCanvas(1242, 2208), x = c.getContext('2d');
            x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(0, 0, 1242, 2208);
            const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
            const id = DB.newId('a');
            await DB.put('assets', { id, projectId: p.id, kind: 'shot', episodeId: e.id, planId, hash: 'h' + planId, mime: 'image/jpeg', width: 1242, height: 2208, blob, createdAt: Date.now() });
            await DB.put('shots', { id: e.id + ':' + planId, projectId: p.id, episodeId: e.id, planId, versions: [id], current: id, hash: 'h' + planId });
        }
        for (const line of VO.episodeLines(e.analysis)) await VO.saveMicTake(p, e, line.id, toBlob(wavs[line.id], 'audio/wav'), voice[line.id]);
        localStorage.setItem('agnes_api_key', 'agnes-test-key');
        localStorage.setItem('drama_open_sections', JSON.stringify({ style: false, chars: false, episodes: false, script: false, images: false, voices: true, clips: true, montage: true, export: true }));
    }, { script: SCRIPT_5_PLANS, colors: COLORS, voice: VOICE, wavs: Object.fromEntries(Object.entries(VOICE).map(([k, d]) => [k, wav(d, 880).toString('base64')])) });
    await openDrama(page, url);
    await fast();
    await page.waitForSelector('#d-sec-clips.open [data-action="gen-clips"]');

    // 1. Section Animation : plans avec réplique cochés, votre voix par défaut
    const checked = await page.evaluate(() => [...document.querySelectorAll('[data-clip-animate]')].map(i => i.dataset.clipAnimate + ':' + i.checked).join(' '));
    check(checked === 'P1:false P2:true P3:true P4:true P5:false', 'section « 🎬 Animation » : P2, P3, P4 cochés (répliques), P1 et P5 en image fixe');
    check(await page.evaluate(() => [...document.querySelectorAll('[data-clip-audio]')].map(s => s.value).join()) === 'own,own,own', 'voix par défaut : 🎤 la vôtre (A)');
    check(/Animer 3 plans/.test(await page.textContent('[data-action="gen-clips"]')) && await badge() === 'EP.1 · 0/3' && /Clip demandé : 5,0 s/.test(await page.textContent('[data-cplan="P2"]')),
        'bouton « 🎬 Animer 3 plans », badge 0/3, clip de 5 s demandé');

    // 2. Animation des 3 plans : créations espacées, suivi, clips enregistrés
    await page.click('[data-action="gen-clips"]');
    await page.waitForSelector('[data-action="stop-clips"]');
    await page.waitForFunction(() => /animation|envoi/.test(document.querySelector('[data-cchip="P2"]')?.textContent || ''));
    check(true, 'pendant l\'animation : « 🎬 animation… » sur le plan, bouton Arrêter');
    await idle();
    await page.waitForFunction(() => document.getElementById('d-badge-clips').textContent === 'EP.1 · 3/3', null, { timeout: 30000 });
    const b = creates[0].body;
    check(creates.length === 3 && b.model === 'agnes-video-v2.0' && b.num_frames === 121 && b.frame_rate === 24 && /^data:image\/jpeg;base64,/.test(b.image) &&
        b.prompt.includes('"Lina, attends !"') && b.negative_prompt && creates[0].auth === 'Bearer agnes-test-key',
        '3 créations : modèle vidéo de l\'onglet Vidéos, 121 images à 24 i/s, image du plan, réplique dans le prompt');
    const gaps = creates.slice(1).map((c, i) => (c.at - creates[i].at) / 1000);
    check(gaps.every(g => g >= 0.95), 'créations espacées (1 s en test, 62 s en vrai) : ' + gaps.map(g => g.toFixed(1)).join(' / ') + ' s');
    check(polls.length >= 6 && polls.every(p => p.model === 'agnes-video-v2.0'), 'suivi de chaque création (' + polls.length + ' consultations)');
    let st = await state();
    check(st.states === 'P1:off P2:ok P3:ok P4:ok P5:off' && Math.abs(st.clips.P2.duration - 5.04) < 0.06 && st.clips.P2.hasAudio && st.clips.P2.width === 288,
        'clips enregistrés : ' + st.clips.P2.duration + ' s, ' + st.clips.P2.width + '×' + st.clips.P2.height + ', avec son');
    check(st.plans.filter(p => p.clip).map(p => p.id).join() === 'P2,P3,P4' && !st.clipAudio.length && st.p3voice.assetId,
        'montage : P2, P3, P4 animés, votre voix gardée (son des clips coupé)');
    check(await page.locator('#d-body-clips video.d-shot').count() === 3 && /🎬 3/.test(await page.textContent('#d-body-montage .queue-summary')), 'clips affichés dans la section, « 🎬 3 » dans le montage');

    // 3. Aperçu : le clip remplace l'image fixe
    const t2 = st.plans[1].start;
    let px = await frameAt(1.0);
    check(close(px, COLORS.P1), 'aperçu à 1,0 s : P1 en image fixe ' + JSON.stringify(px));
    px = await frameAt(t2 + 1.2);
    check(close(px, CLIP_A), 'aperçu dans P2 : image du clip animé ' + JSON.stringify(px));
    await frameAt(t2 + 0.2);
    await page.click('[data-action="preview-play"]');
    await page.waitForFunction(() => /Pause/.test(document.getElementById('d-preview-btn').textContent));
    await page.waitForTimeout(900);
    const playing = await page.evaluate(() => ({ px: [...document.getElementById('d-canvas').getContext('2d').getImageData(270, 400, 1, 1).data].slice(0, 3),
        t: parseFloat(document.getElementById('d-seek').value) }));
    await page.click('[data-action="preview-play"]');
    check(close(playing.px, CLIP_A) && playing.t > t2 + 0.6, 'lecture de l\'aperçu : le clip joue pendant P2 ' + JSON.stringify(playing));

    // 4. Voix d'Agnes (B) pour P3 : durée du plan = durée du clip, son du clip mixé
    await page.selectOption('[data-clip-audio="P3"]', 'agnes');
    await waitToast(page, /P3 : voix d'Agnes/);
    await page.waitForFunction(() => /dite par Agnes/.test(document.querySelector('[data-vchip="P3:0"]')?.textContent || ''));
    st = await state();
    const p3 = st.plans[2];
    check(Math.abs(p3.duration - st.clips.P3.duration) < 0.002 && st.clipAudio.length === 1 && st.clipAudio[0].planId === 'P3',
        'P3 en voix d\'Agnes : plan de ' + p3.duration + ' s (durée du clip), son du clip au montage');
    check(st.p3voice.agnes && !st.p3voice.assetId && !st.missingVoices.length && st.cue3 && st.cue3.start >= p3.start,
        'réplique de Lina dite par Agnes : pas de prise utilisée, sous-titre gardé, rien de manquant');
    check(/durée du clip/.test(await page.textContent('#d-body-voices')) && await page.textContent('#d-badge-voices') === 'EP.1 · 3/3',
        'section Voix : « 🎬 dite par Agnes dans le clip », plan « durée du clip », 3/3');

    // 5. Export : clips image par image et son du clip
    await page.click('[data-action="start-export"]');
    await page.waitForFunction(() => /✅ MP4/.test(document.getElementById('d-badge-export')?.textContent || ''), null, { timeout: 400000 });
    const dec = await page.evaluate(async ([t2, p3]) => {
        const M = await import('./drama/js/model.js');
        const EX = await import('./drama/js/export.js');
        const e = (await M.listEpisodes((await M.listProjects())[0].id))[0];
        const file = await EX.getExportFile(e.exportInfo.file);
        const v = document.createElement('video');
        v.muted = true; v.src = URL.createObjectURL(file);
        await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('lecture impossible')); });
        const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
        const x = c.getContext('2d');
        const at = async t => { await new Promise(r => { v.onseeked = r; v.currentTime = t; }); x.drawImage(v, 0, 0, 1080, 1920); return [...x.getImageData(540, 700, 1, 1).data].slice(0, 3); };
        const out = { d: v.duration, p1: await at(1.0), p2a: await at(t2 + 1.2), p3a: await at(p3.start + 1.0), p3b: await at(p3.start + 4.0) };
        const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await file.arrayBuffer());
        const d = buf.getChannelData(0), sr = buf.sampleRate;
        const rms = (a, b) => { let s = 0, n = 0; for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / n); };
        out.audio = { p3: rms(p3.start + 3.2, p3.start + 4.2), p1: rms(0.5, 1.5) };
        return out;
    }, [t2, p3]);
    check(close(dec.p1, COLORS.P1) && close(dec.p2a, CLIP_A), 'MP4 : P1 en image fixe, P2 animé ' + JSON.stringify([dec.p1, dec.p2a]));
    check(close(dec.p3a, CLIP_A) && close(dec.p3b, CLIP_B), 'MP4 : P3 suit le clip image par image (1re puis 2e moitié) ' + JSON.stringify([dec.p3a, dec.p3b]));
    check(dec.audio.p3 > 0.05 && dec.audio.p3 > dec.audio.p1 * 3, 'MP4 : son du clip d\'Agnes pendant P3 ' + JSON.stringify(dec.audio));
    let info = await inApp(page, async ({ M }) => (await M.listEpisodes((await M.listProjects())[0].id))[0].exportInfo);
    const total1 = info.frames;

    // 6. P4 décoché : image fixe à nouveau ; seuls les plans touchés sont réencodés
    await page.uncheck('[data-clip-animate="P4"]');
    await page.waitForFunction(() => document.getElementById('d-badge-clips').textContent === 'EP.1 · 2/2');
    st = await state();
    check(!st.plans[3].clip && st.clips.P4 && /image fixe/.test(await chip('P4')), 'P4 décoché : image fixe dans le montage, son clip reste gardé');
    await page.waitForFunction(() => /à refaire/.test(document.getElementById('d-badge-export').textContent));
    check(true, 'export signalé « à refaire »');
    await page.click('[data-action="start-export"]');
    await page.waitForFunction(() => /✅ MP4/.test(document.getElementById('d-badge-export')?.textContent || ''), null, { timeout: 400000 });
    info = await inApp(page, async ({ M }) => (await M.listEpisodes((await M.listProjects())[0].id))[0].exportInfo);
    check(info.reused > 0 && info.encoded < total1, 'nouvel export : ' + info.encoded + ' images réencodées (P4, P5 en fondu), ' + info.reused + ' reprises');

    // 7. Reprise après fermeture : la création envoyée n'est pas relancée
    await page.check('[data-clip-animate="P1"]');
    await page.waitForFunction(() => /Animer 1 plan/.test(document.querySelector('[data-action="gen-clips"]')?.textContent || ''));
    sc.hold = true;
    const nCreates = creates.length;
    await page.click('[data-action="gen-clips"]');
    while (creates.length === nCreates) await page.waitForTimeout(100);
    await page.waitForFunction(() => /animation/.test(document.querySelector('[data-cchip="P1"]')?.textContent || ''));
    await reload();
    check(/en préparation chez Agnes/.test(await chip('P1')) && /1 en préparation/.test(await page.textContent('[data-action="gen-clips"]')),
        'appli rouverte : P1 « ⏳ en préparation chez Agnes »');
    sc.hold = false;
    await page.click('[data-action="gen-clips"]');
    await idle();
    await page.waitForFunction(() => /✅ clip prêt/.test(document.querySelector('[data-cchip="P1"]')?.textContent || ''), null, { timeout: 30000 });
    check(creates.length === nCreates + 1, 'reprise : le clip de P1 est récupéré sans nouvelle création');

    // 8. Erreurs : 429 puis succès, échec d'Agnes, clé refusée
    sc.fail429 = 1;
    const n429 = creates.length;
    await page.click('[data-cplan="P2"] [data-action="regen-clip"]');
    while (creates.length < n429 + 2) await page.waitForTimeout(100);     // 429, puis nouvel essai accepté
    await page.waitForSelector('[data-action="stop-clips"]', { state: 'detached', timeout: 30000 });
    await idle();
    await page.waitForFunction(() => /✅ clip prêt/.test(document.querySelector('[data-cchip="P2"]')?.textContent || ''), null, { timeout: 30000 });
    st = await state();
    check(st.clips.P2.versions === 2 && /v2\/2/.test(await page.textContent('[data-cplan="P2"]')), '« Autre clip » après un 429 : nouvel essai puis version 2/2');
    await page.click('[data-cplan="P2"] [data-action="clip-version"][data-dir="-1"]');
    await page.waitForFunction(() => /v1\/2/.test(document.querySelector('[data-cplan="P2"]').textContent));
    check(true, '◀ revient au premier clip');
    await page.check('[data-clip-animate="P5"]');
    await page.waitForSelector('[data-cplan="P5"] [data-action="regen-clip"]:not([disabled])');
    sc.failIds.add('vid' + (nId + 1));
    await page.click('[data-action="gen-clips"]');
    await idle();
    await page.waitForFunction(() => /❌/.test(document.querySelector('[data-cchip="P5"]')?.textContent || ''), null, { timeout: 30000 });
    check(/Agnes n'a pas pu animer ce plan \(failed\)/.test(await chip('P5')), 'échec chez Agnes : « ❌ Agnes n\'a pas pu animer ce plan »');
    sc.refuse = true;
    await page.click('[data-action="gen-clips"]');
    await waitToast(page, /Clé Agnes refusée/);
    await idle();
    sc.refuse = false;
    check(true, 'clé refusée : message clair, animation arrêtée');

    // 8 bis. Hébergeur du clip sans autorisation CORS (« Failed to fetch » sur le téléphone)
    sc.cdnBlocked = true;
    await page.click('[data-action="gen-clips"]');
    await page.waitForSelector('[data-action="stop-clips"]', { state: 'detached', timeout: 30000 });
    await page.waitForFunction(() => /✅ clip prêt/.test(document.querySelector('[data-cchip="P5"]')?.textContent || ''), null, { timeout: 30000 });
    check(contents.length === 1 && contents[0].auth === 'Bearer agnes-test-key', 'adresse du clip bloquée : clip récupéré par l\'API Agnes (/videos/{id}/content)');
    sc.content = false;
    const nC = creates.length;
    await page.click('[data-cplan="P5"] [data-action="regen-clip"]');
    while (creates.length === nC) await page.waitForTimeout(100);
    await page.waitForSelector('[data-action="stop-clips"]', { state: 'detached', timeout: 30000 });
    await page.waitForFunction(() => /à télécharger/.test(document.querySelector('[data-cchip="P5"]')?.textContent || ''), null, { timeout: 30000 });
    const href = await page.getAttribute('[data-cplan="P5"] a.char-btn', 'href');
    check(/cdn\.agnes\.test\/vid\d+\.mp4/.test(href) && /Importer le clip/.test(await page.textContent('[data-cplan="P5"]')),
        'tout est bloqué : « ⬇️ prêt chez Agnes », lien « Ouvrir le clip » et explication pour l\'importer');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-cplan="P5"] [data-action="import-clip"]')]);
    await chooser.setFiles({ name: 'clip-p5.mp4', mimeType: 'video/mp4', buffer: CLIP });
    await waitToast(page, /Clip de P5 importé/);
    await page.waitForFunction(() => /✅ clip prêt/.test(document.querySelector('[data-cchip="P5"]')?.textContent || ''));
    st = await state();
    check(st.clips.P5.versions === 2 && st.plans[4].clip, 'clip téléchargé puis importé : P5 animé (version 2/2)');
    sc.cdnBlocked = false; sc.content = true;

    // 9. Image du plan régénérée : clip à refaire, image fixe en attendant
    await inApp(page, async ({ M, DB }) => {
        const e = (await M.listEpisodes((await M.listProjects())[0].id))[0];
        const sh = await DB.get('shots', e.id + ':P2');
        sh.hash = 'hP2-v2';
        await DB.put('shots', sh);
    });
    await reload();
    st = await state();
    check(/à refaire/.test(await chip('P2')) && !st.plans[1].clip, 'image de P2 changée : clip « à refaire », image fixe dans le montage');

    // 10. Sauvegarde : les clips suivent la série
    await page.click('[data-dtoggle="backup"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-full"]')]);
    const data = JSON.parse(await readFile(await dl.path(), 'utf8'));
    check(data.clips.length === 5 && data.assets.filter(a => a.kind === 'clip').length === 5 && data.clips.find(c => c.planId === 'P3').audio === 'agnes',
        'sauvegarde : réglages des 5 plans + clip retenu de chaque plan (voix d\'Agnes de P3 comprise)');
    await inApp(page, async ({ M }, d) => { await M.importProject(d); }, data);
    const imp = await inApp(page, async ({ M }) => {
        const CL = await import('./drama/js/clips.js');
        const p = (await M.listProjects()).find(x => x.name === 'Néons Brisés' && x.id !== localStorage.getItem('drama_current_project'));
        const e = (await M.listEpisodes(p.id))[0];
        return (await CL.clipStates(p, await M.listCharacters(p.id), e)).map(s => s.plan.id + ':' + s.state + ':' + s.audio).join(' ');
    });
    check(/P3:ok:agnes/.test(imp) && /P1:ok/.test(imp), 'série importée : clips à jour sans rien refaire (' + imp + ')');

    check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
} catch (e) {
    check(false, 'exception : ' + e.message);
    console.log(e.stack);
} finally {
    await browser.close();
    server.close();
    done();
}
