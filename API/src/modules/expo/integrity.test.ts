import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { checkSingleIntegrity } from './integrity'

// Build a minimal single-platform extracted layout on disk: metadata.json +
// launch bundle, no app.json/package.json/assets — exactly what an embedded
// from-base ships.
let tmp: string
let dir: string
let zip: string

beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'integrity-embedded-'))
  dir = path.join(tmp, 'extracted')
  zip = path.join(tmp, 'artifact.zip')
  await fs.promises.mkdir(path.join(dir, 'bundles'), { recursive: true })
  await fs.promises.writeFile(
    path.join(dir, 'metadata.json'),
    JSON.stringify({ fileMetadata: { android: { bundle: 'bundles/b', assets: [] } } }),
  )
  await fs.promises.writeFile(path.join(dir, 'bundles', 'b'), 'hermes-bytecode')
  await fs.promises.writeFile(zip, 'zip-bytes')
})
afterEach(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true })
})

const base = () => ({ _id: 'x', path: dir, filename: zip, version: '55.1_dev', releaseChannel: 'production' })

describe('checkSingleIntegrity — embedded records', () => {
  test('an embedded record with no app.json/package.json is clean', async () => {
    const res = await checkSingleIntegrity({ ...base(), embedded: true, platform: 'android' })
    expect(res.issues.find((i) => i.category === 'app-json')).toBeUndefined()
    expect(res.issues.find((i) => i.category === 'package-json')).toBeUndefined()
    expect(res.errorCount).toBe(0)
  })

  test('an embedded record still errors when its launch bundle is missing', async () => {
    await fs.promises.rm(path.join(dir, 'bundles', 'b'))
    const res = await checkSingleIntegrity({ ...base(), embedded: true, platform: 'android' })
    expect(res.issues.some((i) => i.category === 'bundle')).toBe(true)
    expect(res.errorCount).toBeGreaterThan(0)
  })

  test('a non-embedded record without app.json/package.json still reports errors', async () => {
    const res = await checkSingleIntegrity(base())
    expect(res.issues.some((i) => i.category === 'app-json')).toBe(true)
    expect(res.issues.some((i) => i.category === 'package-json')).toBe(true)
  })
})
