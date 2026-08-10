import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Db } from 'mongodb'

import { up } from '../../migrations/20260810120000-embedded-uploads-unique-index'
import { isDuplicateKeyError } from '../../src/modules/mongo-errors'
import { connectTestDb, hasTestMongo } from '../helpers/mongo'

describe.skipIf(!hasTestMongo)('embedded uploads partial unique index', () => {
  let db: Db
  let drop: () => Promise<void>
  const KEY = {
    project: 'petsee',
    version: '55.1_dev',
    releaseChannel: 'production',
    platform: 'android',
    updateId: 'a10096be-14e3-47da-8d1c-9bebb61c9932',
  }

  beforeAll(async () => {
    ;({ db, drop } = await connectTestDb('embedded-index'))
    await up(db)
  })
  afterAll(async () => {
    await drop()
  })

  test('rejects a second embedded record on the same key', async () => {
    await db.collection('uploads').insertOne({ ...KEY, embedded: true } as never)
    let err: unknown
    try {
      await db.collection('uploads').insertOne({ ...KEY, embedded: true } as never)
    } catch (e) {
      err = e
    }
    expect(isDuplicateKeyError(err)).toBe(true)
  })

  test('allows the same embedded id on a different release channel', async () => {
    await db.collection('uploads').insertOne({ ...KEY, releaseChannel: 'preview', embedded: true } as never)
    expect(await db.collection('uploads').countDocuments({ updateId: KEY.updateId, embedded: true })).toBe(2)
  })

  test('does not constrain non-embedded uploads (partial filter)', async () => {
    const normal = { project: 'petsee', version: '55.1_dev', releaseChannel: 'production' }
    // Distinct objects — the driver stamps _id onto the passed object, so
    // reusing one would trip the _id index rather than exercise the partial one.
    await db.collection('uploads').insertOne({ ...normal } as never)
    await db.collection('uploads').insertOne({ ...normal } as never)
    // Count only the non-embedded rows — an embedded record from earlier tests
    // shares this (project, version, channel) triple.
    expect(await db.collection('uploads').countDocuments({ ...normal, embedded: { $exists: false } })).toBe(2)
  })
})
