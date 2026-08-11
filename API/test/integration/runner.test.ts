import { afterAll, beforeAll, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { migrateDown, migrateUp, migrationStatus } from '../../src/modules/migrations/runner'
import { connectTestDb, hasTestMongo } from '../helpers/mongo'

let dir: string

beforeAll(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mig-'))
  await fs.promises.writeFile(
    path.join(dir, '20200101000000-add-marker.ts'),
    `import type { Db } from 'mongodb'
export const up = async (db: Db) => { await db.collection('marker').insertOne({ _id: 'm1' }) }
export const down = async (db: Db) => { await db.collection('marker').deleteOne({ _id: 'm1' }) }
`,
  )
  await fs.promises.writeFile(
    path.join(dir, '20200102000000-irreversible.ts'),
    `import type { Db } from 'mongodb'
export const up = async (db: Db) => { await db.collection('marker').insertOne({ _id: 'm2' }) }
`,
  )
})

afterAll(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true })
})

test.skipIf(!hasTestMongo)('migrateUp applies pending in order, records them, and is idempotent', async () => {
  const { db, drop } = await connectTestDb('runner-up')
  try {
    const first = await migrateUp(db, dir)
    expect(first.applied).toEqual(['20200101000000-add-marker.ts', '20200102000000-irreversible.ts'])
    expect(await db.collection('marker').countDocuments()).toBe(2)

    const second = await migrateUp(db, dir)
    expect(second.applied).toEqual([])

    const status = await migrationStatus(db, dir)
    expect(status.pending).toEqual([])
    expect(status.applied.length).toBe(2)
  } finally {
    await drop()
  }
})

test.skipIf(!hasTestMongo)('migrateDown refuses an irreversible (no-down) migration', async () => {
  const { db, drop } = await connectTestDb('runner-down')
  try {
    await migrateUp(db, dir)
    await expect(migrateDown(db, { steps: 1 }, dir)).rejects.toThrow('irreversible')
    expect(await db.collection('marker').countDocuments({ _id: 'm2' } as never)).toBe(1)
  } finally {
    await drop()
  }
})

test.skipIf(!hasTestMongo)('migrateDown reverts a reversible migration and removes its record', async () => {
  const revDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mig-rev-'))
  await fs.promises.writeFile(
    path.join(revDir, '20200101000000-add-marker.ts'),
    `import type { Db } from 'mongodb'
export const up = async (db: Db) => { await db.collection('marker').insertOne({ _id: 'r1' }) }
export const down = async (db: Db) => { await db.collection('marker').deleteOne({ _id: 'r1' }) }
`,
  )
  const { db, drop } = await connectTestDb('runner-down-ok')
  try {
    await migrateUp(db, revDir)
    expect(await db.collection('marker').countDocuments({ _id: 'r1' } as never)).toBe(1)
    const res = await migrateDown(db, { steps: 1 }, revDir)
    expect(res.reverted).toEqual(['20200101000000-add-marker.ts'])
    expect(await db.collection('marker').countDocuments({ _id: 'r1' } as never)).toBe(0)
    const status = await migrationStatus(db, revDir)
    expect(status.applied).toEqual([])
  } finally {
    await drop()
    await fs.promises.rm(revDir, { recursive: true, force: true })
  }
})
