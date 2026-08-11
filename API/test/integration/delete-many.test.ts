import { expect, test } from 'bun:test'

// Same circular-import workaround as release.test.ts: evaluate the services
// barrel before importing utils as an entry module.
import '../../src/services'
import { Service } from '../../src/services/utils'

// In-memory stand-in for the feathers services deleteMany → deleteRelease
// touches: `uploads` (get/patch/find), plus `patches` and `patch-pairs`
// exercised by deleteRelease's cascade (empty here — the fixture rows have no
// patches). Rows carry no real disk files, so removeOne just records
// existed:false and moves on.
function makeApp(store: any[]) {
  const matches = (u: any, query: Record<string, any>) =>
    Object.entries(query).every(([k, cond]) => {
      if (k === '$or' && Array.isArray(cond)) return cond.some((q) => matches(u, q))
      if (k === '$limit') return true
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

  const patches = {
    async find() {
      return []
    },
    async remove() {
      return {}
    },
  }

  const patchPairs = { pruneEmpty() {} }

  return {
    service(name: string) {
      if (name === 'uploads') return uploads
      if (name === 'patches') return patches
      if (name === 'patch-pairs') return patchPairs
      throw new Error(`unexpected service requested: ${name}`)
    },
  }
}

test('deleteMany soft-deletes deletable rows and skips released / already-deleted', async () => {
  const store = [
    { _id: 'R', project: 'p', version: '1', releaseChannel: 'prod', status: 'released', updateId: 'uR' },
    { _id: 'D', project: 'p', version: '1', releaseChannel: 'prod', status: 'deleted', updateId: 'uD' },
    { _id: 'C', project: 'p', version: '1', releaseChannel: 'prod', status: 'ready', updateId: 'uC' },
    { _id: 'O', project: 'p', version: '1', releaseChannel: 'prod', status: 'obsolete', updateId: 'uO' },
  ]

  const svc = new Service()
  svc.setup(makeApp(store) as any)

  const res = await svc.deleteMany({ uploadIds: ['R', 'D', 'C', 'O'] })

  const byId = (id: string) => store.find((u) => u._id === id)

  // Only the two deletable rows were soft-deleted.
  expect(res.deleted).toBe(2)
  expect(byId('C').status).toBe('deleted')
  expect(byId('O').status).toBe('deleted')

  // released must never be touched — it's the live release.
  expect(byId('R').status).toBe('released')
  // already-deleted stays a tombstone (re-delete is a no-op we skip).
  expect(byId('D').status).toBe('deleted')

  // Both untouchable rows are reported as skipped with a reason.
  const skippedById = Object.fromEntries(res.skipped.map((s: any) => [s.uploadId, s.reason]))
  expect(skippedById).toEqual({ R: 'released', D: 'already-deleted' })
  expect(res.errors).toHaveLength(0)
})

test('deleteMany rejects an empty or missing uploadIds list', async () => {
  const svc = new Service()
  svc.setup(makeApp([]) as any)

  await expect(svc.deleteMany({ uploadIds: [] })).rejects.toThrow(/uploadIds/i)
  await expect(svc.deleteMany({})).rejects.toThrow(/uploadIds/i)
})

test('deleteMany records a not-found id as skipped, not an error', async () => {
  const store = [{ _id: 'C', project: 'p', version: '1', releaseChannel: 'prod', status: 'ready', updateId: 'uC' }]
  const svc = new Service()
  svc.setup(makeApp(store) as any)

  const res = await svc.deleteMany({ uploadIds: ['C', 'ghost'] })

  expect(res.deleted).toBe(1)
  const skippedById = Object.fromEntries(res.skipped.map((s: any) => [s.uploadId, s.reason]))
  expect(skippedById.ghost).toBe('not-found')
})
