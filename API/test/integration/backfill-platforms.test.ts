import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import type { Db } from 'mongodb'
import * as os from 'os'
import * as path from 'path'

import { up } from '../../migrations/20260813120000-backfill-upload-platforms'
import { connectTestDb, hasTestMongo } from '../helpers/mongo'

describe.skipIf(!hasTestMongo)('backfill uploads.platforms migration', () => {
  let db: Db
  let drop: () => Promise<void>
  let tmp: string

  const seedMetadata = (name: string, fileMetadata: Record<string, unknown>): string => {
    const dir = path.join(tmp, name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ fileMetadata }))
    return dir
  }

  beforeAll(async () => {
    ;({ db, drop } = await connectTestDb('backfill-platforms'))
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'backfill-platforms-'))

    await db.collection('uploads').insertMany([
      // normal, both platforms on disk
      { _id: 'both', project: 'p', version: '55', path: seedMetadata('both', { ios: {}, android: {} }) },
      // normal, single platform on disk
      { _id: 'ios-only', project: 'p', version: '55', path: seedMetadata('ios-only', { ios: {} }) },
      // embedded from-base: platform is stored on the row, not read from disk
      { _id: 'emb', project: 'p', version: '55', embedded: true, platform: 'android' },
      // soft-deleted: no path → platforms stays empty
      { _id: 'gone', project: 'p', version: '55', status: 'deleted', path: null },
      // already backfilled → must NOT be touched
      { _id: 'pre', project: 'p', version: '55', platforms: ['ios'], path: seedMetadata('pre', { ios: {}, android: {} }) },
    ] as never)

    await up(db)
  })

  afterAll(async () => {
    await drop()
    await fs.promises.rm(tmp, { recursive: true, force: true })
  })

  const platformsOf = async (id: string): Promise<string[] | undefined> => {
    const doc = await db.collection('uploads').findOne({ _id: id } as never)
    return doc?.platforms as string[] | undefined
  }

  test('normal multi-platform upload gets both keys from metadata.json', async () => {
    expect(((await platformsOf('both')) || []).sort()).toEqual(['android', 'ios'])
  })

  test('single-platform upload gets just its key', async () => {
    expect(await platformsOf('ios-only')).toEqual(['ios'])
  })

  test('embedded upload uses its stored platform', async () => {
    expect(await platformsOf('emb')).toEqual(['android'])
  })

  test('upload with no readable path gets an empty array', async () => {
    expect(await platformsOf('gone')).toEqual([])
  })

  test('already-backfilled row is left untouched', async () => {
    expect(await platformsOf('pre')).toEqual(['ios'])
  })

  test('creates the listing index', async () => {
    const indexes = await db.collection('uploads').indexes()
    expect(indexes.some((i) => i.name === 'updates_listing')).toBe(true)
  })

  test('is idempotent — a second run changes nothing', async () => {
    await up(db)
    expect(((await platformsOf('both')) || []).sort()).toEqual(['android', 'ios'])
    expect(await platformsOf('pre')).toEqual(['ios'])
  })
})
