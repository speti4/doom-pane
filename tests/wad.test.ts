import { describe, expect, test } from 'claude-code/testing'

import { assembleWad, describeWad, fromBase64, inspectWad, parseManifest, planWad, type WadPlan } from '../hooks/wad'
import { base64Of, tinyIwad, tinyManifest, tinyParts } from './fixtures'

const manifestPlan = (): WadPlan => planWad('tiny', ['manifest.json', 'part-000.bin', 'part-001.bin'], JSON.stringify(tinyManifest()))
const barePlan = (): WadPlan => planWad('tiny', ['part-000.bin', 'part-001.bin'])

describe('parseManifest', () => {
  test('accepts what bundle-freedoom writes', () => {
    const manifest = parseManifest(JSON.stringify(tinyManifest()))
    expect(manifest.name).toBe('tiny.wad')
    expect(manifest.parts).toHaveLength(2)
  })

  test('refuses malformed manifests with a reason', () => {
    expect(() => parseManifest('{')).toThrow('not JSON')
    expect(() => parseManifest('[]')).toThrow('not an object')
    expect(() => parseManifest(JSON.stringify({ ...tinyManifest(), format: 'x' }))).toThrow('doom-pane-wad/1')
    expect(() => parseManifest(JSON.stringify({ ...tinyManifest(), name: '../x.wad' }))).toThrow('.wad file name')
    expect(() => parseManifest(JSON.stringify({ ...tinyManifest(), size: 999 }))).toThrow('add up to')
    expect(() => parseManifest(JSON.stringify({ ...tinyManifest(), parts: [] }))).toThrow('empty')
    expect(() => parseManifest(JSON.stringify({ ...tinyManifest(), parts: [{ file: 'a/b', size: 36 }] }))).toThrow('malformed')
  })
})

describe('planWad', () => {
  test('with a manifest the parts and the name come from it', () => {
    const plan = manifestPlan()
    expect(plan.name).toBe('tiny.wad')
    expect(plan.files).toEqual(['part-000.bin', 'part-001.bin'])
    expect(plan.manifest?.numlumps).toBe(1)
  })

  test('without one every part file in natural order, named after the folder', () => {
    const plan = planWad('DOOM2', ['part-10.bin', 'COPYING.txt', 'part-2.bin', 'README.md', '.DS_Store', 'part-1.bin'])
    expect(plan.name).toBe('doom2.wad')
    expect(plan.files).toEqual(['part-1.bin', 'part-2.bin', 'part-10.bin'])
    expect(plan.manifest).toBeUndefined()
    expect(planWad('doom2.wad', ['xaa', 'xab']).name).toBe('doom2.wad')
    expect(planWad('doom2.wad', ['xab', 'xaa']).files).toEqual(['xaa', 'xab'])
  })

  test('refuses an empty folder and a strange folder name', () => {
    expect(() => planWad('doom2', ['COPYING.txt'])).toThrow('no part files')
    expect(() => planWad('a b', ['part-000.bin'])).toThrow('not a WAD folder name')
  })
})

describe('inspectWad and assembleWad', () => {
  test('reads the header and checks the directory', () => {
    expect(inspectWad(tinyIwad())).toEqual({ magic: 'IWAD', numlumps: 1, infotableofs: 20 })
    expect(() => inspectWad(new Uint8Array(4))).toThrow('shorter')
    expect(() => inspectWad(new Uint8Array(12))).toThrow('magic')
    const broken = tinyIwad()
    new DataView(broken.buffer).setInt32(4, 99, true)
    expect(() => inspectWad(broken)).toThrow('corrupt')
  })

  test('joins the parts and checks them against the manifest', () => {
    const bytes = assembleWad(manifestPlan(), tinyParts())
    expect([...bytes]).toEqual([...tinyIwad()])
    expect(() => assembleWad(manifestPlan(), tinyParts().slice(1))).toThrow('parts read')
    const short = tinyParts()
    short[1] = short[1]!.slice(1)
    expect(() => assembleWad(manifestPlan(), short)).toThrow('bytes')
    const plan = manifestPlan()
    expect(() => assembleWad({ ...plan, manifest: { ...plan.manifest!, numlumps: 2 } }, tinyParts())).toThrow('lumps')
  })

  test('joins the parts of a bare folder and still wants an IWAD', () => {
    expect([...assembleWad(barePlan(), tinyParts())]).toEqual([...tinyIwad()])
    const pwad = tinyParts()
    pwad[0] = Uint8Array.from(pwad[0]!)
    pwad[0]![0] = 0x50 // PWAD
    expect(() => assembleWad(barePlan(), pwad)).toThrow('not an IWAD')
    expect(() => assembleWad(barePlan(), tinyParts().slice(1))).toThrow('parts read')
  })
})

describe('helpers', () => {
  test('fromBase64 decodes standard padded base64', () => {
    const bytes = Uint8Array.from({ length: 40 }, (_, i) => (i * 53) & 255)
    expect([...fromBase64(base64Of(bytes))]).toEqual([...bytes])
    expect([...fromBase64(base64Of(bytes.subarray(0, 37)))]).toEqual([...bytes.subarray(0, 37)])
  })

  test('describeWad names the known IWADs', () => {
    expect(describeWad('freedoom1.wad')).toBe('Freedoom: Phase 1')
    expect(describeWad('doom1.wad')).toContain('shareware')
    expect(describeWad('DOOM2.WAD')).toContain('Hell on Earth')
    expect(describeWad('mine.wad')).toBe('mine.wad')
  })
})
