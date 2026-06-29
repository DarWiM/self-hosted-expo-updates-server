import { MongoClient, type Db } from 'mongodb'

const TEST_MONGO_CONN = process.env.TEST_MONGO_CONN

/** True when integration tests can run. Use with test.skipIf(!hasTestMongo). */
export const hasTestMongo = !!TEST_MONGO_CONN

/**
 * Connect to a uniquely-named throwaway database. The unique name keeps
 * parallel test files from colliding. Always call drop() in a finally —
 * it drops the DB and closes the client.
 */
export async function connectTestDb(label: string): Promise<{ db: Db; drop: () => Promise<void> }> {
  if (!TEST_MONGO_CONN) throw new Error('TEST_MONGO_CONN not set')
  const dbName = `updater_test_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  const client = await MongoClient.connect(TEST_MONGO_CONN)
  const db = client.db(dbName)
  return {
    db,
    drop: async () => {
      await db.dropDatabase()
      await client.close()
    },
  }
}
