#!/usr/bin/env node
// Bundles Freedoom Phase 1 into the plugin, a developer step: downloads the
// 0.13.0 release zip (or takes --zip <path>), verifies its SHA-256 against the
// release's CHECKSUM file, extracts freedoom1.wad and COPYING.txt, splits the
// WAD into 2 MiB parts (the mod reads files through $.fs.read, which rejects a
// file over 4 MiB) and writes a manifest beside them. The parts are committed,
// so the person installing the plugin needs nothing. Node 18+, no dependencies.
//
//   node tools/bundle-freedoom.mjs [--zip <freedoom-0.13.0.zip>] [--out <dir>]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const PART_SIZE = 2 * 1024 * 1024;
const RELEASE = {
  version: '0.13.0',
  url: 'https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip',
  // SHA256 (freedoom-0.13.0.zip) from the signed freedoom-0.13.0-CHECKSUM of the release
  zipSha256: '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59',
  wad: 'freedoom-0.13.0/freedoom1.wad',
  copying: 'freedoom-0.13.0/COPYING.txt',
  wadName: 'freedoom1.wad',
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

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

async function download(url) {
  process.stdout.write(`downloading ${url} ... `);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  console.log(`${bytes.length} bytes`);
  return bytes;
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
    sha256: sha256(bytes),
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
  const out = argument(args, '--out') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'wads', 'freedoom1');
  if (args.length > 0) {
    console.error('usage: node bundle-freedoom.mjs [--zip <freedoom-0.13.0.zip>] [--out <dir>]');
    process.exit(2);
  }
  const zip = zipPath ? new Uint8Array(readFileSync(zipPath)) : await download(RELEASE.url);
  const digest = sha256(zip);
  if (digest !== RELEASE.zipSha256) throw new Error(`zip SHA-256 ${digest}, expected ${RELEASE.zipSha256}`);
  const entries = unzip(zip);
  const wad = entries.get(RELEASE.wad);
  const copying = entries.get(RELEASE.copying);
  if (!wad || !copying) throw new Error(`zip: ${RELEASE.wad} or ${RELEASE.copying} missing`);
  const { manifest, parts } = split(wad, RELEASE.wadName);
  mkdirSync(out, { recursive: true });
  for (const part of parts) writeFileSync(join(out, part.file), part.bytes);
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ...manifest, source: `Freedoom ${RELEASE.version}, ${RELEASE.url}` }, null, 2) + '\n');
  writeFileSync(join(out, 'COPYING.txt'), copying);
  console.log(`${RELEASE.wadName}: ${manifest.size} bytes, ${manifest.numlumps} lumps, sha256 ${manifest.sha256}, ${parts.length} parts -> ${out}`);
}

main(process.argv.slice(2)).catch(error => {
  console.error(`bundle-freedoom: ${error.message}`);
  process.exit(1);
});
