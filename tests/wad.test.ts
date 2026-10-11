import { describe, expect, test } from 'claude-code/testing'

import { assembleWad, describeWad, fromBase64, inspectWad, parseManifest } from '../hooks/wad'
import { base64Of, tinyIwad, tinyManifest, tinyParts } from './fixtures'

describe('parseManifest', () => {
  test('accepts what prepare-wad writes', () => {
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
    const bytes = assembleWad(tinyManifest(), tinyParts())
    expect([...bytes]).toEqual([...tinyIwad()])
    expect(() => assembleWad(tinyManifest(), tinyParts().slice(1))).toThrow('parts read')
    const short = tinyParts()
    short[1] = short[1]!.slice(1)
    expect(() => assembleWad(tinyManifest(), short)).toThrow('bytes')
    expect(() => assembleWad({ ...tinyManifest(), numlumps: 2 }, tinyParts())).toThrow('lumps')
  })
})

describe('helpers', () => {
  test('fromBase64 decodes standard padded base64', () => {
    const bytes = Uint8Array.from({ length: 40 }, (_, i) => (i * 53) & 255)
    expect([...fromBase64(base64Of(bytes))]).toEqual([...bytes])
    expect([...fromBase64(base64Of(bytes.subarray(0, 37)))]).toEqual([...bytes.subarray(0, 37)])
  })

  test('describeWad names the known IWADs', () => {
    expect(describeWad('doom1.wad')).toContain('shareware')
    expect(describeWad('DOOM2.WAD')).toContain('Hell on Earth')
    expect(describeWad('mine.wad')).toBe('mine.wad')
  })
})
