import { describe, expect, test } from 'bun:test'

import { parseEmbeddedMetadata } from './helpers'

describe('parseEmbeddedMetadata', () => {
  const VALID_ID = 'a10096be-14e3-47da-8d1c-9bebb61c9932'

  test('non-embedded metadata returns { embedded: false }', () => {
    expect(parseEmbeddedMetadata({ fileMetadata: { android: {}, ios: {} } })).toEqual({ embedded: false })
  })

  test('embedded:false is treated as non-embedded', () => {
    expect(parseEmbeddedMetadata({ embedded: false, fileMetadata: { android: {} } })).toEqual({ embedded: false })
  })

  test('embedded metadata resolves platform from the single fileMetadata key (android)', () => {
    const meta = { embedded: true, updateId: VALID_ID, fileMetadata: { android: { bundle: 'bundles/x', assets: [] } } }
    expect(parseEmbeddedMetadata(meta)).toEqual({ embedded: true, updateId: VALID_ID, platform: 'android' })
  })

  test('embedded metadata resolves platform ios', () => {
    const meta = { embedded: true, updateId: VALID_ID, fileMetadata: { ios: { bundle: 'bundles/x', assets: [] } } }
    expect(parseEmbeddedMetadata(meta)).toEqual({ embedded: true, updateId: VALID_ID, platform: 'ios' })
  })

  test('embedded without updateId throws', () => {
    expect(() => parseEmbeddedMetadata({ embedded: true, fileMetadata: { android: {} } })).toThrow(/updateId/)
  })

  test('embedded with malformed updateId throws', () => {
    const meta = { embedded: true, updateId: 'not-a-uuid', fileMetadata: { android: {} } }
    expect(() => parseEmbeddedMetadata(meta)).toThrow(/updateId/)
  })

  test('embedded with two platform keys throws', () => {
    const meta = { embedded: true, updateId: VALID_ID, fileMetadata: { android: {}, ios: {} } }
    expect(() => parseEmbeddedMetadata(meta)).toThrow(/exactly one platform/i)
  })

  test('embedded with an unknown platform key throws', () => {
    const meta = { embedded: true, updateId: VALID_ID, fileMetadata: { windows: {} } }
    expect(() => parseEmbeddedMetadata(meta)).toThrow(/platform/i)
  })

  test('embedded with empty fileMetadata throws', () => {
    const meta = { embedded: true, updateId: VALID_ID, fileMetadata: {} }
    expect(() => parseEmbeddedMetadata(meta)).toThrow(/platform/i)
  })

  test('embedded with missing fileMetadata throws', () => {
    expect(() => parseEmbeddedMetadata({ embedded: true, updateId: VALID_ID })).toThrow(/platform/i)
  })
})
