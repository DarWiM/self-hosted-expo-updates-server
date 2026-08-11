import { expect, test } from 'bun:test'
import * as path from 'path'

import { migrateUp } from '../../src/modules/migrations/runner'
import { connectTestDb, hasTestMongo } from '../helpers/mongo'

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations')

test.skipIf(!hasTestMongo)('repair migration restores flipped tombstones only', async () => {
  const { db, drop } = await connectTestDb('repair')
  try {
    await db.collection('uploads').insertMany([
      { _id: 'flipped', status: 'obsolete', deletedAt: new Date('2021-06-01'), path: null, filename: null },
      { _id: 'legit-obsolete', status: 'obsolete' },
      { _id: 'good-tombstone', status: 'deleted', deletedAt: new Date('2021-06-01') },
      { _id: 'ready', status: 'ready' },
    ] as never)

    await migrateUp(db, MIGRATIONS_DIR)

    const byId = async (id: string) => (await db.collection('uploads').findOne({ _id: id } as never))!
    expect((await byId('flipped')).status).toBe('deleted')
    expect((await byId('legit-obsolete')).status).toBe('obsolete')
    expect((await byId('good-tombstone')).status).toBe('deleted')
    expect((await byId('ready')).status).toBe('ready')
  } finally {
    await drop()
  }
})
