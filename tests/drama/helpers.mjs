// Outils communs aux tests Drama : serveur statique + navigateur Playwright.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Playwright : installé dans le projet ou globalement (npm i -g playwright).
export function loadPlaywright() {
    const require = createRequire(import.meta.url);
    try { return require('playwright'); } catch (e) {
        const globalRoot = execSync('npm root -g').toString().trim();
        return require(join(globalRoot, 'playwright'));
    }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

export function startServer() {
    const server = http.createServer(async (req, res) => {
        let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (path.endsWith('/')) path += 'index.html';
        const file = normalize(join(ROOT, path));
        if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
        } catch (e) { res.writeHead(404).end('404'); }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
        resolve({ server, url: 'http://127.0.0.1:' + server.address().port })));
}

let failures = 0;
export function check(cond, label) {
    console.log((cond ? '  ✓ ' : '  ✗ ') + label);
    if (!cond) failures++;
}
export function done() {
    console.log(failures ? '\n' + failures + ' échec(s)' : '\nTous les tests passent');
    process.exitCode = failures ? 1 : 0;
}

// Image PNG de test générée dans la page (pas de fichier binaire dans le dépôt).
export async function makePng(page, w, h, color) {
    const b64 = await page.evaluate(([w, h, color]) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h);
        return c.toDataURL('image/png').split(',')[1];
    }, [w, h, color]);
    return { name: color.replace('#', 'c') + '.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

// ─── Appli intégrée : onglet Drama de l'Atelier ───────────────────
// Ouvre l'appli sur l'onglet Drama et attend son premier affichage.
export async function openDrama(page, url) {
    await page.goto(url + '/atelier/#drama');
    await page.waitForSelector('#drama-root[data-ready="1"]');
}

// Exécute du code dans la page avec les modules Drama (M = modèle, IMG = images, DB = base).
export function inApp(page, fn, arg) {
    return page.evaluate(async ([src, arg]) => {
        const M = await import('./drama/js/model.js');
        const IMG = await import('./drama/js/images.js');
        const DB = await import('./drama/js/db.js');
        return (0, eval)('(' + src + ')')({ M, IMG, DB }, arg);
    }, [fn.toString(), arg]);
}

// Touche un bouton qui ouvre le sélecteur de fichier, puis choisit le fichier.
export async function choose(page, selector, file) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(selector)]);
    await chooser.setFiles(file);
}

export const toastText = page => page.textContent('#toast-text');
export const waitToast = (page, re) => page.waitForFunction(r => new RegExp(r).test(document.getElementById('toast-text').textContent), re.source);

// Fichier audio WAV (mono 16 bits) : sinusoïde de `freq` Hz pendant `seconds` secondes.
export function wav(seconds, freq = 220, rate = 22050, amp = 8000) {
    const n = Math.round(seconds * rate);
    const buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * freq) * amp), 44 + i * 2);
    return buf;
}
