import type { Db } from 'mongodb'
import * as fs from 'fs'
import * as path from 'path'

export type MigrationModule = {
  up: (db: Db) => Promise<void>
  down?: (db: Db) => Promise<void>
}

const MIGRATION_RE = /^(\d{14})-([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/

export function parseMigrationName(file: string): { timestamp: string; name: string } {
  const m = MIGRATION_RE.exec(file)
  if (!m) {
    throw new Error(`Invalid migration filename: ${file} (expected YYYYMMDDHHMMSS-kebab-name.ts)`)
  }
  return { timestamp: m[1], name: m[2] }
}

export function computePending(appliedNames: string[], files: string[]): string[] {
  const applied = new Set(appliedNames)
  return files.filter((f) => !applied.has(f)).sort()
}

const MIGRATIONS_COLLECTION = '_migrations'
const LOCK_COLLECTION = '_migrations_lock'
const LOCK_ID = 'singleton'

// runner.ts lives at src/modules/migrations/ → project migrations dir is three up.
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations')

async function listMigrationFiles(dir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.promises.readdir(dir)
  } catch {
    return []
  }
  return entries.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()
}

async function appliedNames(db: Db): Promise<string[]> {
  const docs = await db.collection(MIGRATIONS_COLLECTION).find({}, { projection: { _id: 1 } }).toArray()
  return docs.map((d) => String(d._id))
}

async function acquireLock(db: Db): Promise<void> {
  try {
    await db.collection(LOCK_COLLECTION).insertOne({ _id: LOCK_ID, acquiredAt: new Date() } as never)
  } catch (e) {
    if ((e as { code?: number })?.code === 11000) {
      throw new Error('Migration lock held by another runner; aborting.')
    }
    throw e
  }
}

async function releaseLock(db: Db): Promise<void> {
  await db.collection(LOCK_COLLECTION).deleteOne({ _id: LOCK_ID } as never)
}

async function loadMigration(dir: string, file: string): Promise<MigrationModule> {
  const mod = (await import(path.join(dir, file))) as Partial<MigrationModule>
  if (typeof mod.up !== 'function') throw new Error(`Migration ${file} has no up() export`)
  return mod as MigrationModule
}

export async function migrationStatus(db: Db, dir = DEFAULT_MIGRATIONS_DIR) {
  const files = await listMigrationFiles(dir)
  const applied = await appliedNames(db)
  return { applied: applied.sort(), pending: computePending(applied, files) }
}

export async function migrateUp(db: Db, dir = DEFAULT_MIGRATIONS_DIR): Promise<{ applied: string[] }> {
  await acquireLock(db)
  const applied: string[] = []
  try {
    const pending = computePending(await appliedNames(db), await listMigrationFiles(dir))
    for (const file of pending) {
      const mod = await loadMigration(dir, file)
      await mod.up(db)
      await db.collection(MIGRATIONS_COLLECTION).insertOne({ _id: file, appliedAt: new Date() } as never)
      applied.push(file)
    }
  } finally {
    await releaseLock(db)
  }
  return { applied }
}

export async function migrateDown(
  db: Db,
  opts: { steps?: number } = {},
  dir = DEFAULT_MIGRATIONS_DIR,
): Promise<{ reverted: string[] }> {
  const steps = opts.steps ?? 1
  await acquireLock(db)
  const reverted: string[] = []
  try {
    const targets = (await appliedNames(db)).sort().slice(-steps).reverse()
    for (const file of targets) {
      const mod = await loadMigration(dir, file)
      if (typeof mod.down !== 'function') {
        throw new Error(`Migration ${file} is irreversible (no down export)`)
      }
      await mod.down(db)
      await db.collection(MIGRATIONS_COLLECTION).deleteOne({ _id: file } as never)
      reverted.push(file)
    }
  } finally {
    await releaseLock(db)
  }
  return { reverted }
}
