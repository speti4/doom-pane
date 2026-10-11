// WAD: a prepared IWAD is a folder of parts, each under the 4 MiB `$.fs.read`
// allows, with or without a manifest.json beside them (the bundled Freedoom has
// one; a person's own IWAD split with the OS's tools has none). Pure; the glue
// lists and reads the files.

export type ManifestPart = { file: string; size: number }

export type Manifest = {
  format: 'doom-pane-wad/1'
  /** The IWAD's file name as DOOM identifies it (`freedoom1.wad`, `doom2.wad`). */
  name: string
  size: number
  numlumps: number
  parts: ManifestPart[]
}

export type WadHeader = { magic: 'IWAD' | 'PWAD'; numlumps: number; infotableofs: number }

/** What to read for one IWAD: its part files in order and the name DOOM gets. */
export type WadPlan = { name: string; files: string[]; manifest?: Manifest }

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

/** A part file: anything in the folder that is not a text beside the parts (manifest, licence, readme). */
const isPartFile = (file: string): boolean => !file.startsWith('.') && !/\.(json|txt|md|adoc|html|htm|pdf)$/i.test(file)

/** Natural order: `part-2` before `part-10`, `xaa` before `xab`. */
const compareNames = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true })

/**
 * Turns a WAD folder's listing into what to read. With a manifest the parts come
 * from it; without one every part file in natural order, and the folder's name
 * (`doom2`, or `doom2.wad`) is the IWAD's name.
 */
export function planWad(dirName: string, fileNames: readonly string[], manifestText?: string): WadPlan {
  if (manifestText !== undefined) {
    const manifest = parseManifest(manifestText)
    return { name: manifest.name, files: manifest.parts.map(part => part.file), manifest }
  }
  if (!/^[\w.-]+$/.test(dirName)) throw new Error(`${dirName}: not a WAD folder name`)
  const files = fileNames.filter(isPartFile).sort(compareNames)
  if (files.length === 0) throw new Error(`${dirName}: no part files in the folder`)
  const lower = dirName.toLowerCase()
  return { name: lower.endsWith('.wad') ? lower : `${lower}.wad`, files }
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

/** Joins the parts in order, checks them against the manifest where there is one, and that the whole is an IWAD. */
export function assembleWad(plan: WadPlan, parts: readonly Uint8Array[]): Uint8Array {
  const { manifest, name } = plan
  if (parts.length !== plan.files.length) throw new Error(`${parts.length} parts read, ${plan.files.length} listed`)
  if (manifest !== undefined) {
    parts.forEach((part, index) => {
      const expected = manifest.parts[index]
      if (expected === undefined || part.length !== expected.size) {
        throw new Error(`${expected?.file ?? `part ${index}`} is ${part.length} bytes, manifest says ${expected?.size ?? '?'}`)
      }
    })
  }
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const bytes = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.length
  }
  const header = inspectWad(bytes)
  if (header.magic !== 'IWAD') throw new Error(`${name} is a ${header.magic}, not an IWAD`)
  if (manifest !== undefined && header.numlumps !== manifest.numlumps) throw new Error(`${name} has ${header.numlumps} lumps, manifest says ${manifest.numlumps}`)
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
    case 'freedoom1.wad':
      return 'Freedoom: Phase 1'
    case 'freedoom2.wad':
      return 'Freedoom: Phase 2'
    case 'freedm.wad':
      return 'FreeDM'
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
    default:
      return name
  }
}
