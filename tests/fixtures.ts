// A tiny IWAD for the tests: a header, one 8-byte lump and its directory.
// DOOM rejects it ("Unknown or invalid IWAD file"), which is what the engine
// tests want: the whole read path runs and the engine's exit is reported.
import type { Manifest } from '../hooks/wad'

export const TINY_WAD_NAME = 'tiny.wad'

export function tinyIwad(): Uint8Array {
  const lump = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const bytes = new Uint8Array(12 + lump.length + 16)
  const view = new DataView(bytes.buffer)
  bytes.set([0x49, 0x57, 0x41, 0x44], 0) // IWAD
  view.setInt32(4, 1, true) // numlumps
  view.setInt32(8, 12 + lump.length, true) // infotableofs
  bytes.set(lump, 12)
  const dir = 12 + lump.length
  view.setInt32(dir, 12, true) // filepos
  view.setInt32(dir + 4, lump.length, true) // size
  bytes.set([0x44, 0x55, 0x4d, 0x4d, 0x59, 0, 0, 0], dir + 8) // DUMMY
  return bytes
}

export function tinyManifest(partSize = 20): Manifest {
  const bytes = tinyIwad()
  const parts: Manifest['parts'] = []
  for (let at = 0, i = 0; at < bytes.length; at += partSize, i++) {
    parts.push({ file: `part-${String(i).padStart(3, '0')}.bin`, size: Math.min(partSize, bytes.length - at) })
  }
  return { format: 'doom-pane-wad/1', name: TINY_WAD_NAME, size: bytes.length, numlumps: 1, parts }
}

export function tinyParts(partSize = 20): Uint8Array[] {
  const bytes = tinyIwad()
  const parts: Uint8Array[] = []
  for (let at = 0; at < bytes.length; at += partSize) parts.push(bytes.slice(at, Math.min(at + partSize, bytes.length)))
  return parts
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64, written out so the tests do not lean on the code under test. */
export function base64Of(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += BASE64.charAt((n >> 18) & 63) + BASE64.charAt((n >> 12) & 63)
    out += b === undefined ? '=' : BASE64.charAt((n >> 6) & 63)
    out += c === undefined ? '=' : BASE64.charAt(n & 63)
  }
  return out
}
