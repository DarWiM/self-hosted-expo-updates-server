import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import type { UnknownRecord, UploadRecord } from '../../types'
import { replaceExistingEmbedded } from './helpers'

// Minimal in-memory stand-in for the feathers `uploads` service — only the
// find/remove surface replaceExistingEmbedded touches. The query matcher does
// plain equality, which is all the idempotency key uses.
function makeUploads(store: UploadRecord[]) {
  const matches = (u: UploadRecord, q: UnknownRecord) => Object.entries(q).every(([k, v]) => u[k] === v)
  return {
    removed: [] as unknown[],
    async find({ query }: { query: UnknownRecord }) {
      return store.filter((u) => matches(u, query))
    },
    async remove(id: unknown) {
      const i = store.findIndex((u) => String(u._id) === String(id))
      const [r] = store.splice(i, 1)
      this.removed.push(id)
      return r
    },
  }
}

let tmp: string
beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'embedded-replace-'))
})
afterEach(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true })
})

const KEY = { project: 'petsee', version: '55.1_dev', releaseChannel: 'production', platform: 'android' }
const ID = 'a10096be-14e3-47da-8d1c-9bebb61c9932'

const seedOnDisk = (name: string) => {
  const dir = path.join(tmp, name)
  const zip = path.join(tmp, `${name}.zip`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'metadata.json'), '{}')
  fs.writeFileSync(zip, 'zip-bytes')
  return { path: dir, filename: zip }
}

describe('replaceExistingEmbedded', () => {
  test('removes a prior embedded record with the same key (row + files), keeps keepId', async () => {
    const oldFiles = seedOnDisk('old')
    const store: UploadRecord[] = [
      { _id: 'old', embedded: true, updateId: ID, ...KEY, ...oldFiles } as UploadRecord,
      { _id: 'new', embedded: true, updateId: ID, ...KEY } as UploadRecord,
    ]
    const uploads = makeUploads(store)

    const res = await replaceExistingEmbedded(uploads, { ...KEY, updateId: ID }, 'new')

    expect(res.removed).toBe(1)
    expect(store.map((u) => u._id)).toEqual(['new'])
    expect(fs.existsSync(oldFiles.path)).toBe(false)
    expect(fs.existsSync(oldFiles.filename)).toBe(false)
  })

  test('returns removed:0 when nothing else shares the key', async () => {
    const store: UploadRecord[] = [{ _id: 'new', embedded: true, updateId: ID, ...KEY } as UploadRecord]
    const uploads = makeUploads(store)
    const res = await replaceExistingEmbedded(uploads, { ...KEY, updateId: ID }, 'new')
    expect(res.removed).toBe(0)
    expect(store.map((u) => u._id)).toEqual(['new'])
  })

  test('does not remove a record on a different channel', async () => {
    const store: UploadRecord[] = [
      { _id: 'preview', embedded: true, updateId: ID, ...KEY, releaseChannel: 'preview' } as UploadRecord,
      { _id: 'new', embedded: true, updateId: ID, ...KEY } as UploadRecord,
    ]
    const uploads = makeUploads(store)
    const res = await replaceExistingEmbedded(uploads, { ...KEY, updateId: ID }, 'new')
    expect(res.removed).toBe(0)
    expect(store.map((u) => u._id).sort()).toEqual(['new', 'preview'])
  })

  test('never removes the keepId record itself', async () => {
    const store: UploadRecord[] = [{ _id: 'new', embedded: true, updateId: ID, ...KEY } as UploadRecord]
    const uploads = makeUploads(store)
    await replaceExistingEmbedded(uploads, { ...KEY, updateId: ID }, 'new')
    expect(uploads.removed).toEqual([])
  })
})
