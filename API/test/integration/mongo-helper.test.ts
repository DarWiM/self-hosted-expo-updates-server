import { expect, test } from 'bun:test'

import { connectTestDb, hasTestMongo } from '../helpers/mongo'

test.skipIf(!hasTestMongo)('connectTestDb gives an isolated db that drops cleanly', async () => {
  const { db, drop } = await connectTestDb('helper-smoke')
  try {
    await db.collection('probe').insertOne({ _id: 'x' } as never)
    expect(await db.collection('probe').countDocuments()).toBe(1)
  } finally {
    await drop()
  }
})
