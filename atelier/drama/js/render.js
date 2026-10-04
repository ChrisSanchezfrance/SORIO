// Drama — dessin d'une image du montage au temps t (aperçu et export).
// ctx : contexte 2D d'un canvas de (1080 × 1920) × scale.
// getImage(assetId) : image décodée (ImageBitmap) ou null si pas encore chargée.
// opts.getClip(plan, temps) : image du clip animé (étape 8) à ce temps, ou null (l'image fixe est
// alors dessinée à sa place).

import { W, H, SUB_SIZES, cameraAt, planIndexAt, cueAt, ease } from './montage.js';

// Temps dans le clip d'un plan animé : la dernière image reste affichée si le plan est plus long.
export const clipTimeAt = (plan, local) => Math.max(0, Math.min(local, plan.clip.duration - 1 / 48));

function drawPlan(ctx, plan, local, getImage, s, getClip) {
    const src = plan.clip && getClip ? getClip(plan, clipTimeAt(plan, local)) : null;
    const sw = src && (src.videoWidth || src.width), sh = src && (src.videoHeight || src.height);
    if (sw && sh) {
        // clip plein cadre (recadré au centre), sans mouvement de caméra : c'est Agnes qui anime
        const k = Math.max(W * s / sw, H * s / sh);
        ctx.drawImage(src, (W * s - sw * k) / 2, (H * s - sh * k) / 2, sw * k, sh * k);
        return;
    }
    const p = plan.duration > 0 ? local / plan.duration : 0;
    const cam = cameraAt(plan.moves, Math.min(1, Math.max(0, p)), Math.max(0, local), plan.seed);
    const img = plan.imageAssetId ? getImage(plan.imageAssetId) : null;
    const w = W * s * cam.z, h = H * s * cam.z;
    const x = (W * s - w) / 2 + cam.x * s, y = (H * s - h) / 2 + cam.y * s;
    if (img) {
        ctx.drawImage(img, x, y, w, h);
    } else {
        // image pas encore générée (ou en cours de chargement) : fond sombre et numéro du plan
        const g = ctx.createLinearGradient(0, 0, 0, H * s);
        g.addColorStop(0, '#2b2b33'); g.addColorStop(1, '#111114');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W * s, H * s);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '600 ' + Math.round(90 * s) + 'px -apple-system, Roboto, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(plan.id, W * s / 2, H * s * 0.42);
        ctx.font = Math.round(36 * s) + 'px -apple-system, Roboto, Helvetica, Arial, sans-serif';
        ctx.fillText(plan.imageAssetId ? 'chargement…' : 'image à générer', W * s / 2, H * s * 0.42 + 80 * s);
    }
}

function overlay(ctx, color, alpha, s) {
    if (alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W * s, H * s);
    ctx.globalAlpha = 1;
}

function wrapLines(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
        const test = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(test).width > maxWidth) { lines.push(cur); cur = w; }
        else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
}

function drawSubtitle(ctx, cue, tl, s) {
    const size = (SUB_SIZES[tl.settings.subSize] || SUB_SIZES.M) * s;
    ctx.font = '800 ' + Math.round(size) + 'px -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const lines = wrapLines(ctx, cue.text, W * s * 0.86);
    const lh = size * 1.18;
    const bottom = H * s * 0.86;
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => {
        const yy = bottom - (lines.length - 1 - i) * lh;
        ctx.strokeText(line, W * s / 2, yy);
        ctx.fillText(line, W * s / 2, yy);
    });
}

// Dessine le montage au temps t. opts.scale : 1 pour l'export (1080×1920), 0,5 pour l'aperçu.
export function drawFrame(ctx, tl, t, getImage, opts = {}) {
    const s = opts.scale || 1;
    const gc = opts.getClip || null;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W * s, H * s);
    if (!tl.plans.length) { ctx.restore(); return null; }
    const i = planIndexAt(tl, t);
    const plan = tl.plans[i];
    const prev = i > 0 ? tl.plans[i - 1] : null;
    const local = t - plan.start;
    const tr = plan.transition;
    const inTr = tr.type !== 'coupe' && tr.duration > 0 && local < tr.duration;
    const q = inTr ? Math.max(0, local) / tr.duration : 1;

    if (!inTr) {
        drawPlan(ctx, plan, local, getImage, s, gc);
    } else if (tr.type === 'fondu') {
        if (prev) drawPlan(ctx, prev, prev.duration, getImage, s, gc);
        ctx.globalAlpha = q;
        drawPlan(ctx, plan, local, getImage, s, gc);
        ctx.globalAlpha = 1;
    } else if (tr.type === 'fondu-noir' || tr.type === 'fondu-blanc') {
        const color = tr.type === 'fondu-noir' ? '#000' : '#fff';
        if (prev && q < 0.5) { drawPlan(ctx, prev, prev.duration, getImage, s, gc); overlay(ctx, color, q * 2, s); }
        else { drawPlan(ctx, plan, local, getImage, s, gc); overlay(ctx, color, prev ? (1 - q) * 2 : 1 - q, s); }
    } else if (tr.type === 'glisse-gauche' || tr.type === 'glisse-droite') {
        const dir = tr.type === 'glisse-gauche' ? -1 : 1;     // sens du mouvement des images
        const off = ease(q) * W * s;
        if (prev) {
            ctx.save(); ctx.translate(dir * off, 0); drawPlan(ctx, prev, prev.duration, getImage, s, gc); ctx.restore();
        }
        ctx.save(); ctx.translate(dir * (off - W * s), 0); drawPlan(ctx, plan, local, getImage, s, gc); ctx.restore();
    } else if (tr.type === 'flash') {
        drawPlan(ctx, plan, local, getImage, s, gc);
        overlay(ctx, '#fff', 1 - q, s);
    } else {
        drawPlan(ctx, plan, local, getImage, s, gc);
    }

    const cue = tl.settings.subtitles ? cueAt(tl, t) : null;
    if (cue) drawSubtitle(ctx, cue, tl, s);
    ctx.restore();
    return { planIndex: i, cue };
}

// Plans animés dessinés au temps t (plan en cours, et précédent pendant une transition) : [{ plan, time }].
export function clipsAt(tl, t) {
    if (!tl.plans.length) return [];
    const i = planIndexAt(tl, t);
    const plan = tl.plans[i], prev = i > 0 ? tl.plans[i - 1] : null;
    const local = t - plan.start;
    const out = [];
    if (prev && prev.clip && plan.transition.type !== 'coupe' && local < plan.transition.duration) out.push({ plan: prev, time: clipTimeAt(prev, prev.duration) });
    if (plan.clip) out.push({ plan, time: clipTimeAt(plan, local) });
    return out;
}

// Images nécessaires autour du temps t (plan en cours, précédent pour la transition, suivant).
export function imagesAround(tl, t) {
    const i = planIndexAt(tl, t);
    return [tl.plans[i - 1], tl.plans[i], tl.plans[i + 1]].filter(Boolean).map(p => p.imageAssetId).filter(Boolean);
}
