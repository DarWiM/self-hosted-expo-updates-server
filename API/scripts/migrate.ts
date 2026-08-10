import config from 'config'
import * as fs from 'fs'
import { MongoClient, type Db } from 'mongodb'
import * as path from 'path'

import { migrateDown, migrateUp, migrationStatus } from '../src/modules/migrations/runner'

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations')

const TEMPLATE = `import type { Db } from 'mongodb'

export const up = async (db: Db): Promise<void> => {
  // forward migration
}

// Optional rollback — delete this export if the migration is irreversible.
export const down = async (db: Db): Promise<void> => {
  // rollback
}
`

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await MongoClient.connect(String(config.get('mongodb')))
  try {
    return await fn(client.db())
  } finally {
    await client.close()
  }
}

const fmt = (xs: string[]) => (xs.length ? xs.map((x) => `  ${x}`).join('\n') : '  (none)')

async function main() {
  const [cmd, arg] = process.argv.slice(2)
  switch (cmd) {
    case 'up':
      await withDb(async (db) => {
        const r = await migrateUp(db)
        console.log(r.applied.length ? `Applied:\n${fmt(r.applied)}` : 'Nothing to apply.')
      })
      break
    case 'down': {
      const steps = arg ? parseInt(arg, 10) : 1
      if (arg && (Number.isNaN(steps) || steps < 1)) {
        throw new Error('down [n]: n must be a positive integer')
      }
      await withDb(async (db) => {
        const r = await migrateDown(db, { steps })
        console.log(r.reverted.length ? `Reverted:\n${fmt(r.reverted)}` : 'Nothing to revert.')
      })
      break
    }
    case 'status':
      await withDb(async (db) => {
        const s = await migrationStatus(db)
        console.log(`Applied (${s.applied.length}):\n${fmt(s.applied)}\n\nPending (${s.pending.length}):\n${fmt(s.pending)}`)
      })
      break
    case 'create': {
      if (!arg) throw new Error('Usage: migrate create <kebab-name>')
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(arg)) {
        throw new Error('migrate create <name>: name must be lowercase kebab-case (letters, digits, single hyphens)')
      }
      await fs.promises.mkdir(MIGRATIONS_DIR, { recursive: true })
      const file = path.join(MIGRATIONS_DIR, `${timestamp()}-${arg}.ts`)
      await fs.promises.writeFile(file, TEMPLATE)
      console.log(`Created ${file}`)
      break
    }
    default:
      console.log('Usage: migrate <up | down [n] | status | create <name>>')
      process.exit(1)
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error('migrate failed:', e)
    process.exit(1)
  })
}
