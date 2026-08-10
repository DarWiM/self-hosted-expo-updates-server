import { afterEach, expect, test } from 'bun:test'

import { runBootMigrations } from './boot'

afterEach(() => {
  delete process.env.RUN_MIGRATIONS_ON_BOOT
})

test('is a no-op (never touches the db) when the flag is unset', async () => {
  delete process.env.RUN_MIGRATIONS_ON_BOOT
  let migrated = false
  const app = {
    get: () => {
      throw new Error('should not fetch mongoClient when flag is off')
    },
  } as never
  await runBootMigrations(app, async () => {
    migrated = true
  })
  expect(migrated).toBe(false)
})

test('runs migrations against the app db when the flag is true', async () => {
  process.env.RUN_MIGRATIONS_ON_BOOT = 'true'
  const fakeDb = { tag: 'db' }
  let received: unknown = null
  const app = { get: async (k: string) => (k === 'mongoClient' ? fakeDb : null) } as never
  await runBootMigrations(app, async (db) => {
    received = db
  })
  expect(received).toBe(fakeDb)
})
