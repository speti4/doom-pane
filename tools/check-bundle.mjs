#!/usr/bin/env node
// Checks a bundled or prepared IWAD folder the way the mod will see it, then
// runs the generated engine on it for a while: the parts add up to the
// manifest's size and SHA-256, the header is an IWAD's, the engine comes up and
// ticks. A developer check (`claude plugin test` has no file system), Node 18+.
//
//   node tools/check-bundle.mjs [wads/freedoom1] [tics]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [dirArg = join(here, '..', 'wads', 'freedoom1'), ticsArg = '350'] = process.argv.slice(2);
const tics = Number(ticsArg);

const names = readdirSync(dirArg);
const hasManifest = names.includes('manifest.json');
const manifest = hasManifest ? JSON.parse(readFileSync(join(dirArg, 'manifest.json'), 'utf8')) : undefined;
const partNames = manifest
  ? manifest.parts.map(part => part.file)
  : names.filter(name => !name.startsWith('.') && !/[.](json|txt|md|adoc|html|htm|pdf)$/i.test(name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const parts = partNames.map(name => readFileSync(join(dirArg, name)));
const bytes = Buffer.concat(parts);
const wadName = manifest?.name ?? `${dirArg.replace(/[\\/]+$/, '').split(/[\\/]/).pop().toLowerCase().replace(/[.]wad$/, '')}.wad`;

const magic = bytes.subarray(0, 4).toString('latin1');
if (magic !== 'IWAD') throw new Error(`${wadName}: magic "${magic}", not an IWAD`);
const numlumps = bytes.readInt32LE(4);
console.log(`${wadName}: ${parts.length} parts, ${bytes.length} bytes, ${numlumps} lumps${hasManifest ? ', manifest present' : ', no manifest'}`);
if (manifest) {
  if (bytes.length !== manifest.size) throw new Error(`size ${bytes.length}, manifest says ${manifest.size}`);
  if (numlumps !== manifest.numlumps) throw new Error(`${numlumps} lumps, manifest says ${manifest.numlumps}`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== manifest.sha256) throw new Error(`sha256 ${digest}, manifest says ${manifest.sha256}`);
  console.log(`sha256 ${digest}: matches the manifest`);
}

const { default: createDoom } = await import(pathToFileURL(join(here, '..', 'hooks', 'engine', 'doomgeneric.js')).href);
const lines = [];
const t0 = performance.now();
const m = await createDoom({ print: line => lines.push(line), printErr: line => lines.push(line) });
m.FS.writeFile(`/${wadName}`, new Uint8Array(bytes));
try {
  m.FS.mkdir('/.savegame');
} catch {
  // already there
}
m.dg.ticksMs = 1000;
const argv = ['doom', '-iwad', `/${wadName}`, '-nogui'];
const pointers = argv.map(arg => m.stringToNewUTF8(arg));
const argvPointer = m._malloc(4 * (pointers.length + 1));
pointers.forEach((pointer, index) => {
  m.HEAPU32[(argvPointer >> 2) + index] = pointer;
});
m.HEAPU32[(argvPointer >> 2) + pointers.length] = 0;
try {
  m._doomgeneric_Create(pointers.length, argvPointer);
} catch (error) {
  console.error(lines.slice(-5).join('\n'));
  throw new Error(`the engine did not start: ${error.message ?? error}`);
}
const t1 = performance.now();
let frames = 0;
const key = (code, pressed) => m.dg.keys.push({ pressed: pressed ? 1 : 0, key: code & 0xff });
for (let i = 0; i < tics; i++) {
  // through the title and the menu into a new game, then a few steps forward
  if (i === 70 || i === 110 || i === 150 || i === 190) key(13, true);
  if (i === 75 || i === 115 || i === 155 || i === 195) key(13, false);
  if (i === 260) key(0xad, true);
  if (i === 330) key(0xad, false);
  m.dg.ticksMs += 1000 / 35;
  m.dg.frameDirty = false;
  m._doomgeneric_Tick();
  if (m.dg.frameDirty) frames++;
  if (m.dg.quitRequested) throw new Error(`the engine quit at tic ${i}`);
}
const t2 = performance.now();
const width = m._DG_GetScreenWidth();
const height = m._DG_GetScreenHeight();
const screen = m._DG_GetScreenBuffer() >> 2;
let lit = 0;
for (const pixel of m.HEAPU32.subarray(screen, screen + width * height)) if ((pixel & 0xffffff) !== 0) lit++;
console.log(
  `engine up in ${(t1 - t0).toFixed(0)} ms, ${tics} tics in ${(t2 - t1).toFixed(0)} ms (${((t2 - t1) / tics).toFixed(2)} ms/tic), ` +
    `${frames} frames, title "${m.dg.title}", ${lit} of ${width * height} pixels lit, heap ${(m.HEAPU8.length / 1048576).toFixed(0)} MiB`,
);
if (lit === 0) throw new Error('the frame is black');
console.log('ok');
