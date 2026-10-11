#!/usr/bin/env node
// Bundles the game data into the plugin, a developer step: downloads a release
// archive (or takes --zip <path>), verifies it against a pinned digest, extracts
// the IWAD and its licence text, splits the IWAD into 2 MiB parts (the mod reads
// files through $.fs.read, which rejects a file over 4 MiB) and writes a manifest
// beside them. The parts are committed, so the person installing the plugin
// needs nothing. Node 18+, no dependencies.
//
//   node tools/bundle-wads.mjs shareware [--zip <doom19s.zip>] [--out <dir>]
//   node tools/bundle-wads.mjs freedoom  [--zip <freedoom-0.13.0.zip>] [--out <dir>]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const PART_SIZE = 2 * 1024 * 1024;
const HERE = dirname(fileURLToPath(import.meta.url));
const WADS = join(HERE, '..', 'wads');

const SHAREWARE_NOTE = `DOOM shareware, version 1.9: the first episode, "Knee-Deep in the Dead"

Copyright (c) 1993-1995 id Software, Inc. All rights reserved. DOOM is a
trademark of id Software LLC, a ZeniMax Media company.

The files in this folder are id Software's shareware release of DOOM, exactly
as distributed in doom19s.zip on the idgames archive: the part-NNN.bin files
joined in order are the unmodified DOOM1.WAD (4,196,020 bytes, MD5
f0cefca49926d00903cf57551d901abe), and README.TXT is the release's own README.
The WAD is split only because the Claude Code plugin API reads files of at most
4 MiB; nothing in it is changed.

id Software released this episode as shareware: it may be copied and passed on
freely and without charge, it may not be sold, and it may not be modified. The
other two episodes (DOOM, The Ultimate DOOM) and DOOM II are commercial
products; play them from your own copies (README: "Your own IWAD"). The plugin
is not affiliated with or endorsed by id Software or ZeniMax.
`;

const RELEASES = {
  shareware: {
    url: 'https://www.gamers.org/pub/idgames/idstuff/doom/doom19s.zip',
    mirrors: ['https://youfailit.net/pub/idgames/idstuff/doom/doom19s.zip', 'https://ftpmirror1.infania.net/pub/idgames/idstuff/doom/doom19s.zip'],
    digest: { algorithm: 'md5', value: '244d181457c9be5f28b91b488e67e042' },
    wadName: 'doom1.wad',
    wadDigest: { algorithm: 'md5', value: 'f0cefca49926d00903cf57551d901abe' },
    wadSize: 4196020,
    source: 'DOOM shareware 1.9, doom19s.zip from the idgames archive',
    /** doom19s.zip holds a two-part inner archive (DOOMS_19.1 + DOOMS_19.2) with the game. */
    extract(entries) {
      const part1 = entries.get('DOOMS_19.1');
      const part2 = entries.get('DOOMS_19.2');
      if (!part1 || !part2) throw new Error('doom19s.zip: DOOMS_19.1/2 missing');
      const inner = new Uint8Array(part1.length + part2.length);
      inner.set(part1, 0);
      inner.set(part2, part1.length);
      const game = unzip(inner);
      const wad = game.get('DOOM1.WAD');
      const readme = game.get('README.TXT');
      if (!wad || !readme) throw new Error('inner archive: DOOM1.WAD or README.TXT missing');
      return { wad, texts: { 'README.TXT': readme, 'LICENSE.txt': new TextEncoder().encode(SHAREWARE_NOTE) } };
    },
  },
  freedoom: {
    url: 'https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip',
    mirrors: [],
    // SHA256 (freedoom-0.13.0.zip) from the signed freedoom-0.13.0-CHECKSUM of the release
    digest: { algorithm: 'sha256', value: '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59' },
    wadName: 'freedoom1.wad',
    wadDigest: undefined,
    wadSize: undefined,
    source: 'Freedoom 0.13.0, https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip',
    extract(entries) {
      const wad = entries.get('freedoom-0.13.0/freedoom1.wad');
      const copying = entries.get('freedoom-0.13.0/COPYING.txt');
      if (!wad || !copying) throw new Error('freedoom-0.13.0.zip: freedoom1.wad or COPYING.txt missing');
      return { wad, texts: { 'COPYING.txt': copying } };
    },
  },
};

const digestOf = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

/** Reads the 12-byte WAD header and checks the directory fits the file. */
function inspectWad(bytes) {
  if (bytes.length < 12) throw new Error('not a WAD: shorter than its header');
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'IWAD') throw new Error(`not an IWAD: magic "${magic}"`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numlumps = view.getInt32(4, true);
  const infotableofs = view.getInt32(8, true);
  if (numlumps < 0 || infotableofs < 12 || infotableofs + 16 * numlumps > bytes.length) {
    throw new Error(`corrupt WAD directory: ${numlumps} lumps at ${infotableofs} in ${bytes.length} bytes`);
  }
  return { magic, numlumps, infotableofs };
}

/** Minimal ZIP reader: the central directory, then stored or deflated entries. */
function unzip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = String.fromCharCode(...zip.subarray(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + compressed);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8) bytes = new Uint8Array(inflateRawSync(data));
    else throw new Error(`zip: unsupported method ${method} for ${name}`);
    if (bytes.length !== size) throw new Error(`zip: ${name} inflated to ${bytes.length}, expected ${size}`);
    entries.set(name, bytes);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function download(urls) {
  let lastError;
  for (const url of urls) {
    try {
      process.stdout.write(`downloading ${url} ... `);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      console.log(`${bytes.length} bytes`);
      return bytes;
    } catch (error) {
      console.log(`failed (${error.message})`);
      lastError = error;
    }
  }
  throw new Error(`every mirror failed: ${lastError?.message}`);
}

/** Splits the WAD into parts and describes them in the mod's manifest format. */
function split(bytes, name) {
  const header = inspectWad(bytes);
  const parts = [];
  for (let offset = 0, index = 0; offset < bytes.length; offset += PART_SIZE, index++) {
    const chunk = bytes.subarray(offset, Math.min(offset + PART_SIZE, bytes.length));
    parts.push({ file: `part-${String(index).padStart(3, '0')}.bin`, size: chunk.length, bytes: chunk });
  }
  const manifest = {
    format: 'doom-pane-wad/1',
    name,
    size: bytes.length,
    sha256: digestOf('sha256', bytes),
    magic: header.magic,
    numlumps: header.numlumps,
    parts: parts.map(({ file, size }) => ({ file, size })),
  };
  return { manifest, parts };
}

function argument(args, flag) {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
}

async function main(argv) {
  const args = [...argv];
  const zipPath = argument(args, '--zip');
  const outArg = argument(args, '--out');
  const which = args.shift();
  const release = RELEASES[which];
  if (!release || args.length > 0) {
    console.error('usage: node bundle-wads.mjs shareware|freedoom [--zip <archive>] [--out <dir>]');
    process.exit(2);
  }
  const out = outArg ?? join(WADS, release.wadName.replace(/[.]wad$/, ''));
  const zip = zipPath ? new Uint8Array(readFileSync(zipPath)) : await download([release.url, ...release.mirrors]);
  const digest = digestOf(release.digest.algorithm, zip);
  if (digest !== release.digest.value) throw new Error(`archive ${release.digest.algorithm} ${digest}, expected ${release.digest.value}`);
  const { wad, texts } = release.extract(unzip(zip));
  if (release.wadSize !== undefined && wad.length !== release.wadSize) throw new Error(`${release.wadName} is ${wad.length} bytes, expected ${release.wadSize}`);
  if (release.wadDigest !== undefined) {
    const wadDigest = digestOf(release.wadDigest.algorithm, wad);
    if (wadDigest !== release.wadDigest.value) throw new Error(`${release.wadName} ${release.wadDigest.algorithm} ${wadDigest}, expected ${release.wadDigest.value}`);
  }
  const { manifest, parts } = split(wad, release.wadName);
  mkdirSync(out, { recursive: true });
  for (const part of parts) writeFileSync(join(out, part.file), part.bytes);
  for (const [file, bytes] of Object.entries(texts)) writeFileSync(join(out, file), bytes);
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ...manifest, source: release.source }, null, 2) + '\n');
  console.log(`${release.wadName}: ${manifest.size} bytes, ${manifest.numlumps} lumps, sha256 ${manifest.sha256}, ${parts.length} parts -> ${out}`);
}

main(process.argv.slice(2)).catch(error => {
  console.error(`bundle-wads: ${error.message}`);
  process.exit(1);
});
