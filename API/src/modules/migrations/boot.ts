import type { Db } from 'mongodb'

import { migrateUp } from './runner'

type AppLike = { get: (key: string) => Promise<Db> | unknown }

/**
 * Apply pending migrations on boot when RUN_MIGRATIONS_ON_BOOT=true, before the
 * server starts listening. `migrate` is injectable for testing; production uses
 * the real migrateUp. Throws on failure so the caller can refuse to serve.
 */
export async function runBootMigrations(
  app: AppLike,
  migrate: (db: Db) => Promise<unknown> = migrateUp,
): Promise<void> {
  if (process.env.RUN_MIGRATIONS_ON_BOOT !== 'true') return
  const db = (await app.get('mongoClient')) as Db
  await migrate(db)
}
