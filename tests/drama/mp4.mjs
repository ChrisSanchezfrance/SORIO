// Lecture minimale d'un fichier MP4 (structure ISO BMFF), indépendante de l'appli :
// pistes, codec, dimensions, durée et nombre d'échantillons.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta']);

function boxes(buf, start = 0, end = buf.length) {
    const out = [];
    let p = start;
    while (p + 8 <= end) {
        let size = buf.readUInt32BE(p);
        const type = buf.toString('latin1', p + 4, p + 8);
        let header = 8;
        if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); header = 16; }
        else if (size === 0) size = end - p;
        if (size < header || p + size > end) break;
        out.push({ type, start: p, header, end: p + size });
        p += size;
    }
    return out;
}
const child = (buf, box, type) => boxes(buf, box.start + box.header, box.end).find(b => b.type === type);

export function readMp4(buf) {
    const top = boxes(buf);
    const ftyp = top.find(b => b.type === 'ftyp');
    const moov = top.find(b => b.type === 'moov');
    const mdat = top.find(b => b.type === 'mdat');
    if (!moov) return { ok: false, top: top.map(b => b.type) };
    const mvhd = child(buf, moov, 'mvhd');
    const v = buf[mvhd.start + 8];
    const mvTimescale = buf.readUInt32BE(mvhd.start + (v === 1 ? 28 : 20));
    const mvDuration = v === 1 ? Number(buf.readBigUInt64BE(mvhd.start + 32)) : buf.readUInt32BE(mvhd.start + 24);
    const tracks = boxes(buf, moov.start + 8, moov.end).filter(b => b.type === 'trak').map(trak => {
        const tkhd = child(buf, trak, 'tkhd');
        const tv = buf[tkhd.start + 8];
        const wOff = tkhd.start + (tv === 1 ? 96 : 84);
        const mdia = child(buf, trak, 'mdia');
        const mdhd = child(buf, mdia, 'mdhd');
        const mv = buf[mdhd.start + 8];
        const timescale = buf.readUInt32BE(mdhd.start + (mv === 1 ? 28 : 20));
        const duration = mv === 1 ? Number(buf.readBigUInt64BE(mdhd.start + 32)) : buf.readUInt32BE(mdhd.start + 24);
        const hdlr = child(buf, mdia, 'hdlr');
        const handler = buf.toString('latin1', hdlr.start + 16, hdlr.start + 20);
        const stbl = child(buf, child(buf, mdia, 'minf'), 'stbl');
        const stsd = child(buf, stbl, 'stsd');
        const entry = boxes(buf, stsd.start + 16, stsd.end)[0];
        const stsz = child(buf, stbl, 'stsz');
        const samples = stsz ? buf.readUInt32BE(stsz.start + 16) : 0;
        const t = { handler, codec: entry.type, timescale, seconds: duration / timescale, samples };
        if (handler === 'vide') { t.width = buf.readUInt32BE(wOff) / 65536; t.height = buf.readUInt32BE(wOff + 4) / 65536; }
        if (handler === 'soun') { t.channels = buf.readUInt16BE(entry.start + 24); t.sampleRate = buf.readUInt32BE(entry.start + 32) / 65536; }
        return t;
    });
    return { ok: true, brand: ftyp ? buf.toString('latin1', ftyp.start + 8, ftyp.start + 12) : null,
        seconds: mvDuration / mvTimescale, mdatBytes: mdat ? mdat.end - mdat.start : 0, tracks };
}
