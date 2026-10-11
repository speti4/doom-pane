// WAD: the manifest tools/prepare-wad.mjs writes, the parts it splits an IWAD
// into, and the IWAD header. Pure; the glue reads the files.

export type ManifestPart = { file: string; size: number }

export type Manifest = {
  format: 'doom-pane-wad/1'
  /** The IWAD's file name as DOOM identifies it (`doom1.wad`, `doom2.wad`). */
  name: string
  size: number
  numlumps: number
  parts: ManifestPart[]
}

export type WadHeader = { magic: 'IWAD' | 'PWAD'; numlumps: number; infotableofs: number }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Parses and checks a manifest.json; throws with the reason. */
export function parseManifest(text: string): Manifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('manifest.json is not JSON')
  }
  if (!isRecord(value)) throw new Error('manifest.json is not an object')
  if (value.format !== 'doom-pane-wad/1') throw new Error(`manifest format ${String(value.format)} is not doom-pane-wad/1`)
  const { name, size, numlumps, parts } = value
  if (typeof name !== 'string' || !/^[\w.-]+\.wad$/i.test(name)) throw new Error('manifest name is not a .wad file name')
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 12) throw new Error('manifest size is not a byte count')
  if (typeof numlumps !== 'number' || !Number.isInteger(numlumps) || numlumps < 0) throw new Error('manifest numlumps is not a count')
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('manifest parts is empty')
  const checked: ManifestPart[] = parts.map((part: unknown, index) => {
    if (!isRecord(part) || typeof part.file !== 'string' || !/^[\w.-]+$/.test(part.file) || typeof part.size !== 'number') {
      throw new Error(`manifest part ${index} is malformed`)
    }
    return { file: part.file, size: part.size }
  })
  const total = checked.reduce((sum, part) => sum + part.size, 0)
  if (total !== size) throw new Error(`manifest parts add up to ${total}, not ${size}`)
  return { format: 'doom-pane-wad/1', name, size, numlumps, parts: checked }
}

/** Reads the 12-byte header and checks the directory lies inside the file. */
export function inspectWad(bytes: Uint8Array): WadHeader {
  if (bytes.length < 12) throw new Error('not a WAD: shorter than its header')
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0)
  if (magic !== 'IWAD' && magic !== 'PWAD') throw new Error(`not a WAD: magic "${magic}"`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numlumps = view.getInt32(4, true)
  const infotableofs = view.getInt32(8, true)
  if (numlumps < 0 || infotableofs < 12 || infotableofs + 16 * numlumps > bytes.length) {
    throw new Error(`corrupt WAD directory: ${numlumps} lumps at ${infotableofs} in ${bytes.length} bytes`)
  }
  return { magic, numlumps, infotableofs }
}

/** Joins the parts in manifest order and checks the result against the manifest. */
export function assembleWad(manifest: Manifest, parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length !== manifest.parts.length) throw new Error(`${parts.length} parts read, manifest lists ${manifest.parts.length}`)
  const bytes = new Uint8Array(manifest.size)
  let at = 0
  parts.forEach((part, index) => {
    const expected = manifest.parts[index]
    if (expected === undefined || part.length !== expected.size) {
      throw new Error(`${expected?.file ?? `part ${index}`} is ${part.length} bytes, manifest says ${expected?.size ?? '?'}`)
    }
    bytes.set(part, at)
    at += part.length
  })
  const header = inspectWad(bytes)
  if (header.magic !== 'IWAD') throw new Error(`${manifest.name} is a ${header.magic}, not an IWAD`)
  if (header.numlumps !== manifest.numlumps) throw new Error(`${manifest.name} has ${header.numlumps} lumps, manifest says ${manifest.numlumps}`)
  return bytes
}

/** Standard padded base64 to bytes; the runtime's own method where it has one. */
export function fromBase64(text: string): Uint8Array {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(text)
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** What the IWAD's name says about the game, for the person. */
export function describeWad(name: string): string {
  switch (name.toLowerCase()) {
    case 'doom1.wad':
      return 'DOOM shareware (Knee-Deep in the Dead)'
    case 'doom.wad':
      return 'DOOM / The Ultimate DOOM'
    case 'doom2.wad':
      return 'DOOM II: Hell on Earth'
    case 'plutonia.wad':
      return 'Final DOOM: The Plutonia Experiment'
    case 'tnt.wad':
      return 'Final DOOM: TNT Evilution'
    case 'freedoom1.wad':
    case 'freedoom2.wad':
      return 'Freedoom'
    default:
      return name
  }
}
