#!/usr/bin/env node
// Post-processes the emcc -sWASM=0 output so it loads in a Claude Code hooks
// module: ES module export, no eager `console`, and a gate over the globals the
// hooks environment does not have. The output is minified, so the gate works on
// match contexts, not lines.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node postprocess.mjs <doomgeneric.raw.js> <doomgeneric.js>');
  process.exit(2);
}
let src = readFileSync(input, 'utf8');

// 1. shell.js binds console eagerly; the hooks module has no console at all.
const shims = [
  // (the hooks runtime's `console.log` has no `bind`; the driver passes print/printErr anyway)
  [/var out\s*=\s*console\.log\.bind\(console\)/, 'var out=()=>{}'],
  [/var err\s*=\s*console\.error\.bind\(console\)/, 'var err=()=>{}'],
];
for (const [pattern, replacement] of shims) {
  if (!pattern.test(src)) {
    console.error(`postprocess: expected pattern not found: ${pattern}`);
    process.exit(1);
  }
  src = src.replace(pattern, replacement);
}

// 2. ES module export (EXPORT_ES6=0 output ends with a typeof-guarded UMD tail).
if (!/export default createDoom/.test(src)) src += '\nexport default createDoom;\n';

// 3. Gate. A hard failure for a global that would throw at load or that the
// engine must never use; a warning with context for the ones Emscripten keeps
// in paths wasm2js never takes (loading a binary, lazy files, setStatus).
const guardedBefore = (at) => /(?:typeof |\?\.|globalThis\.)[^;{}]*$/.test(src.slice(Math.max(0, at - 48), at));
const scan = (pattern) => {
  const hits = [];
  for (const match of src.matchAll(pattern)) {
    if (guardedBefore(match.index)) continue;
    hits.push(`${match[0]} @${match.index}: …${src.slice(Math.max(0, match.index - 60), match.index + 60)}…`);
  }
  return hits;
};
const hard = scan(/\bconsole\.|\beval\(|new Function\b|import\.meta|\brequire\(|\bprocess\./g);
const soft = scan(/\bsetTimeout\(|\bsetInterval\(|\bfetch\(|\bXMLHttpRequest\b|\bcrypto\.|\bdocument\.|\bwindow\./g);
for (const hit of soft) console.warn(`postprocess: unguarded (expected dead or lazy): ${hit}`);
if (hard.length > 0) {
  console.error(`postprocess: ${hard.length} forbidden global(s):\n${hard.join('\n')}`);
  process.exit(1);
}
writeFileSync(output, src);
console.log(`postprocess: wrote ${output} (${(src.length / 1024).toFixed(0)} KiB, ${soft.length} soft warning(s))`);
