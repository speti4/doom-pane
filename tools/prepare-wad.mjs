#!/usr/bin/env node
// Prepares an IWAD for the doom-pane mod: validates the WAD header, splits it
// into 2 MiB parts (the mod reads files through $.fs.read, which rejects a file
// over 4 MiB) and writes a manifest next to them.
//
//   node prepare-wad.mjs <path-to-iwad> [--out <dir>]
//   node prepare-wad.mjs --shareware [--out <dir>]
//
// --shareware downloads id Software's shareware episode (doom19s.zip from the
// idgames archive), unpacks DOOM1.WAD from its two-stage archive and verifies it
// by size and MD5 before splitting. Default --out: ~/.claude/doom-wads/<name>/
// (the mod's default wadDir). No dependencies beyond Node 18+.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const PART_SIZE = 2 * 1024 * 1024;
const SHAREWARE = {
  zip: 'idstuff/doom/doom19s.zip',
  mirrors: [
    'https://www.gamers.org/pub/idgames/',
    'https://youfailit.net/pub/idgames/',
    'https://ftpmirror1.infania.net/pub/idgames/',
  ],
  zipMd5: '244d181457c9be5f28b91b488e67e042',
  wadName: 'doom1.wad',
  wadSize: 4196020,
  wadMd5: 'f0cefca49926d00903cf57551d901abe',
};
const LICENSE_NOTE =
  'DOOM shareware (c) id Software. The shareware episode may be copied freely and may not be sold or modified; ' +
  'the registered episodes need a bought IWAD (doom.wad, doom2.wad).';

const md5 = bytes => createHash('md5').update(bytes).digest('hex');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Reads the 12-byte WAD header and checks the directory fits the file. */
export function inspectWad(bytes) {
  if (bytes.length < 12) throw new Error('not a WAD: shorter than its header');
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'IWAD' && magic !== 'PWAD') throw new Error(`not a WAD: magic "${magic}"`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numlumps = view.getInt32(4, true);
  const infotableofs = view.getInt32(8, true);
  if (numlumps < 0 || infotableofs < 12 || infotableofs + 16 * numlumps > bytes.length) {
    throw new Error(`corrupt WAD directory: ${numlumps} lumps at ${infotableofs} in ${bytes.length} bytes`);
  }
  return { magic, numlumps, infotableofs };
}

/** Minimal ZIP reader: the central directory, then stored or deflated entries. */
export function unzip(zip) {
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
    entries.set(name.toUpperCase(), bytes);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function download(path) {
  let lastError;
  for (const mirror of SHAREWARE.mirrors) {
    const url = mirror + path;
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

async function fetchShareware() {
  const zip = await download(SHAREWARE.zip);
  const zipMd5 = md5(zip);
  if (zipMd5 !== SHAREWARE.zipMd5) throw new Error(`doom19s.zip MD5 ${zipMd5}, expected ${SHAREWARE.zipMd5}`);
  const outer = unzip(zip);
  const part1 = outer.get('DOOMS_19.1');
  const part2 = outer.get('DOOMS_19.2');
  if (!part1 || !part2) throw new Error('doom19s.zip: DOOMS_19.1/2 missing');
  const inner = new Uint8Array(part1.length + part2.length);
  inner.set(part1, 0);
  inner.set(part2, part1.length);
  const wad = unzip(inner).get('DOOM1.WAD');
  if (!wad) throw new Error('inner archive: DOOM1.WAD missing');
  const wadMd5 = md5(wad);
  if (wad.length !== SHAREWARE.wadSize || wadMd5 !== SHAREWARE.wadMd5) {
    throw new Error(`DOOM1.WAD is ${wad.length} bytes, MD5 ${wadMd5}; expected ${SHAREWARE.wadSize}, ${SHAREWARE.wadMd5}`);
  }
  console.log(LICENSE_NOTE);
  return { name: SHAREWARE.wadName, bytes: wad };
}

/** Splits the WAD into parts and describes them; pure, used by the tests too. */
export function split(bytes, name) {
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
    sha256: sha256(bytes),
    magic: header.magic,
    numlumps: header.numlumps,
    parts: parts.map(({ file, size }) => ({ file, size })),
  };
  return { manifest, parts };
}

async function main(argv) {
  const args = [...argv];
  let out;
  const outAt = args.indexOf('--out');
  if (outAt >= 0) {
    out = args[outAt + 1];
    args.splice(outAt, 2);
  }
  let source;
  if (args[0] === '--shareware') {
    source = await fetchShareware();
  } else if (args[0] && !args[0].startsWith('--')) {
    const name = basename(args[0]).toLowerCase();
    source = { name, bytes: new Uint8Array(readFileSync(args[0])) };
  } else {
    console.error('usage: node prepare-wad.mjs <path-to-iwad> [--out <dir>] | --shareware [--out <dir>]');
    process.exit(2);
  }
  const stem = source.name.replace(/[.]wad$/, '');
  const dir = out ?? join(homedir(), '.claude', 'doom-wads', stem);
  const { manifest, parts } = split(source.bytes, source.name);
  mkdirSync(dir, { recursive: true });
  for (const part of parts) writeFileSync(join(dir, part.file), part.bytes);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${source.name}: ${manifest.size} bytes, ${manifest.numlumps} lumps, ${parts.length} parts -> ${dir}`);
  console.log('In Claude Code: /doom');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`prepare-wad: ${error.message}`);
    process.exit(1);
  });
}
