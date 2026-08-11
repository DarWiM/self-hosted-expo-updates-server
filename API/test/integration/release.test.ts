// utils.ts → ../modules → feathers.config → ../services barrel → utils is a
// circular import. It resolves fine when the app boots from src/index.ts, but
// importing utils.ts *as the entry module* trips an ESM temporal-dead-zone
// error. Evaluating the barrel first lets utils finish initializing before the
// barrel's re-export line runs. The barrel has no eval-time side effects
// (services/mongo are only wired inside functions), so this is safe.
import '../../src/services'

import { afterAll, beforeAll, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { Service } from '../../src/services/utils'

// setRelease runs a pre-flight integrity check on the upload being released
// and refuses if it has any errors. So the release *target* needs real,
// minimally-valid files on disk for the happy path to be exercised. The other
// uploads in the fixture are never integrity-checked by setRelease, so they
// can stay file-less.
let tmpRoot: string
let targetDir: string
let targetZip: string

beforeAll(async () => {
  tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'release-softdelete-'))
  targetDir = path.join(tmpRoot, 'extracted')
  await fs.promises.mkdir(targetDir, { recursive: true })
  // metadata.json with no fileMetadata → integrity walker skips the bundle/asset
  // loop; app.json + package.json present & valid → no app-json/package-json
  // errors. No updateHash on the record → hash drift check is skipped.
  await fs.promises.writeFile(path.join(targetDir, 'metadata.json'), JSON.stringify({}))
  await fs.promises.writeFile(path.join(targetDir, 'app.json'), JSON.stringify({}))
  await fs.promises.writeFile(path.join(targetDir, 'package.json'), JSON.stringify({}))
  targetZip = path.join(tmpRoot, 'target.zip')
  await fs.promises.writeFile(targetZip, 'pretend-zip-bytes')
})

afterAll(async () => {
  await fs.promises.rm(tmpRoot, { recursive: true, force: true })
})

// Minimal in-memory stand-in for the feathers `uploads` service. The query
// matcher understands plain equality plus the $ne / $nin operators that
// setRelease's re-status query uses.
function makeApp(store: any[]) {
  const matches = (u: any, query: Record<string, any>) =>
    Object.entries(query).every(([k, cond]) => {
      if (cond && typeof cond === 'object') {
        if ('$ne' in cond) return u[k] !== cond.$ne
        if ('$nin' in cond) return !cond.$nin.includes(u[k])
      }
      return u[k] === cond
    })

  const uploads = {
    async get(id: string) {
      const u = store.find((x) => x._id === id)
      if (!u) throw new Error(`Not found: ${id}`)
      return u
    },
    async find({ query }: { query: Record<string, any> }) {
      return store.filter((u) => matches(u, query))
    },
    async patch(id: string, data: Record<string, any>) {
      const u = store.find((x) => x._id === id)
      if (!u) throw new Error(`Not found: ${id}`)
      Object.assign(u, data)
      return u
    },
  }

  return {
    service(name: string) {
      if (name === 'uploads') return uploads
      throw new Error(`unexpected service requested: ${name}`)
    },
  }
}

test('releasing an update must not resurrect soft-deleted tombstones', async () => {
  const store = [
    // A: the rollback target being (re)released — has valid files so the
    // pre-flight integrity gate passes.
    {
      _id: 'A',
      project: 'p',
      version: '1',
      releaseChannel: 'prod',
      status: 'obsolete',
      updateId: 'uA',
      filename: targetZip,
      path: targetDir,
    },
    // B: the currently-live release — should be demoted to obsolete.
    {
      _id: 'B',
      project: 'p',
      version: '1',
      releaseChannel: 'prod',
      status: 'released',
      updateId: 'uB',
      releasedAt: '2020-01-01T00:00:00.000Z',
    },
    // C: uploaded but never released — should stay ready.
    { _id: 'C', project: 'p', version: '1', releaseChannel: 'prod', status: 'ready', updateId: 'uC' },
    // D: a soft-deleted tombstone — files already wiped, status 'deleted',
    // releasedAt preserved from when it was live. MUST be left untouched.
    {
      _id: 'D',
      project: 'p',
      version: '1',
      releaseChannel: 'prod',
      status: 'deleted',
      updateId: 'uD',
      deletedAt: '2021-01-01T00:00:00.000Z',
      releasedAt: '2021-06-01T00:00:00.000Z',
      path: null,
      filename: null,
    },
  ]

  const svc = new Service()
  svc.setup(makeApp(store) as any)

  await svc.setRelease({ uploadId: 'A' })

  const byId = (id: string) => store.find((u) => u._id === id)

  // Normal release behaviour still holds:
  expect(byId('A').status).toBe('released')
  expect(byId('B').status).toBe('obsolete')
  expect(byId('C').status).toBe('ready')

  // The regression: the soft-deleted tombstone must keep its 'deleted' status
  // (not be flipped to 'obsolete') and keep its preserved releasedAt.
  expect(byId('D').status).toBe('deleted')
  expect(byId('D').releasedAt).toBe('2021-06-01T00:00:00.000Z')
})

test('releasing an embedded from-base record is refused', async () => {
  // E has valid files, so without the embedded guard the integrity gate would
  // pass and setRelease would happily flip it to 'released' — which would then
  // be served to devices as a (assetless) OTA manifest. The guard blocks it.
  const store = [
    {
      _id: 'E',
      project: 'p',
      version: '1',
      releaseChannel: 'prod',
      status: 'ready',
      updateId: 'a10096be-14e3-47da-8d1c-9bebb61c9932',
      embedded: true,
      platform: 'android',
      path: targetDir,
      filename: targetZip,
    },
  ]

  const svc = new Service()
  svc.setup(makeApp(store) as any)

  await expect(svc.setRelease({ uploadId: 'E' })).rejects.toThrow(/embedded/i)
  expect(store[0].status).toBe('ready')
})
