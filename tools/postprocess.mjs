#!/usr/bin/env node
// Post-processes the emcc -sWASM=0 output so it loads in a Claude Code hooks
// module: a header naming the source and the licence, ES module export, no
// eager `console`, the dead network loaders stubbed, and a gate over the globals
// the hooks environment does not have. The output is minified, so the gate works
// on match contexts, not lines.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node postprocess.mjs <doomgeneric.raw.js> <doomgeneric.js>');
  process.exit(2);
}
let src = readFileSync(input, 'utf8');

// Keep in step with COMMIT in build-engine.sh.
const SOURCE_COMMIT = 'dcb7a8d';
const HEADER =
  `/*! doom-pane engine: ozkl/doomgeneric at ${SOURCE_COMMIT} (id Software's DOOM, GNU GPL v2), compiled to plain\n` +
  ` *  JavaScript with Emscripten by tools/build-engine.sh and post-processed by tools/postprocess.mjs. Generated:\n` +
  ` *  do not edit. Source, patches and licences: THIRD-PARTY.md and LICENSE beside this plugin's manifest. */\n`;

// 1. shell.js binds console eagerly; the hooks runtime has a `console` whose
//    `log` has no `bind`, so the eager binding throws at load. The driver passes
//    print/printErr anyway.
const noNetwork = '(()=>{throw new Error("doom-pane: the engine has no network")})';
const shims = [
  [/var out\s*=\s*console\.log\.bind\(console\)/, 'var out=()=>{}'],
  [/var err\s*=\s*console\.error\.bind\(console\)/, 'var err=()=>{}'],
  // 1b. the loaders Emscripten keeps for fetching a binary or a lazy file: dead
  //     here (the module is embedded, the WAD comes through the FS), stubbed so
  //     the claim "no network" holds for a reader of the file as well
  [/await fetch\(/, `await ${noNetwork}(`],
  [/new XMLHttpRequest\b/g, `${noNetwork}()`],
];
for (const [pattern, replacement] of shims) {
  if (!pattern.test(src)) {
    console.error(`postprocess: expected pattern not found: ${pattern}`);
    process.exit(1);
  }
  src = src.replace(pattern, replacement);
}

// 2. ES module export (EXPORT_ES6=0 output ends with a typeof-guarded UMD tail),
//    and the header.
if (!/export default createDoom/.test(src)) src += '\nexport default createDoom;\n';
if (!src.startsWith('/*!')) src = HEADER + src;

// 3. Gate. A hard failure for a global that would throw at load or that the
// engine must never use (network included, see 1b); a warning with context for
// the ones Emscripten keeps in paths wasm2js never takes (timers, setStatus).
const guardedBefore = (at) => /(?:typeof |\?\.|globalThis\.)[^;{}]*$/.test(src.slice(Math.max(0, at - 48), at));
const scan = (pattern) => {
  const hits = [];
  for (const match of src.matchAll(pattern)) {
    if (guardedBefore(match.index)) continue;
    hits.push(`${match[0]} @${match.index}: …${src.slice(Math.max(0, match.index - 60), match.index + 60)}…`);
  }
  return hits;
};
const hard = scan(/\bconsole\.|\beval\(|new Function\b|import\.meta|\brequire\(|\bprocess\.|\bfetch\(|\bXMLHttpRequest\b|\bWebSocket\b/g);
const soft = scan(/\bsetTimeout\(|\bsetInterval\(|\bcrypto\.|\bdocument\.|\bwindow\./g);
for (const hit of soft) console.warn(`postprocess: unguarded (expected dead or lazy): ${hit}`);
if (hard.length > 0) {
  console.error(`postprocess: ${hard.length} forbidden global(s):\n${hard.join('\n')}`);
  process.exit(1);
}
writeFileSync(output, src);
console.log(`postprocess: wrote ${output} (${(src.length / 1024).toFixed(0)} KiB, ${soft.length} soft warning(s))`);
