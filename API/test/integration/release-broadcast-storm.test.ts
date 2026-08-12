// Same circular-import workaround as release.test.ts.
import '../../src/services'

import { expect, test } from 'bun:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { Service } from '../../src/services/utils'

// Regression guard: each uploads.patch triggers the after:patch hook
// (broadcastUploadChange → messages.create → a 'messages created' socket event
// to every client → invalidateQuery). So patch-count == realtime-broadcast
// count == client refetch bursts. setRelease must patch ONLY rows whose
// status/releasedAt actually change, otherwise a branch with many updates
// floods the socket with no-op broadcasts and stalls realtime for ~30s.
test('setRelease patches only rows that actually change — no broadcast storm', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'release-storm-'))
  const targetDir = path.join(tmpRoot, 'extracted')
  await fs.promises.mkdir(targetDir, { recursive: true })
  await fs.promises.writeFile(path.join(targetDir, 'metadata.json'), JSON.stringify({}))
  await fs.promises.writeFile(path.join(targetDir, 'app.json'), JSON.stringify({}))
  await fs.promises.writeFile(path.join(targetDir, 'package.json'), JSON.stringify({}))
  const targetZip = path.join(tmpRoot, 'target.zip')
  await fs.promises.writeFile(targetZip, 'pretend-zip-bytes')

  // A busy branch: the rollback target (obsolete→released), the currently-live
  // release (released→obsolete), 18 already-obsolete + ready rows that DON'T
  // change, and 30 soft-deleted tombstones (excluded by $ne:'deleted').
  const store: any[] = [
    {
      _id: 'target',
      project: 'p',
      version: '1',
      releaseChannel: 'prod',
      status: 'obsolete',
      updateId: 'uT',
      filename: targetZip,
      path: targetDir,
    },
    {
      _id: 'live',
      project: 'p',
      version: '1',
      releaseChannel: 'prod',
      status: 'released',
      updateId: 'uL',
      releasedAt: '2020-01-01T00:00:00.000Z',
    },
  ]
  for (let i = 0; i < 18; i++) {
    store.push({
      _id: `other-${i}`,
      project: 'p',
      version: '1',
      releaseChannel: 'prod',
      status: i % 2 ? 'ready' : 'obsolete',
      updateId: `u${i}`,
      releasedAt: null,
    })
  }
  for (let i = 0; i < 30; i++) {
    store.push({ _id: `tomb-${i}`, project: 'p', version: '1', releaseChannel: 'prod', status: 'deleted' })
  }

  let patchCalls = 0
  const matches = (u: any, query: Record<string, any>) =>
    Object.entries(query).every(([k, cond]) => {
      if (cond && typeof cond === 'object' && '$ne' in cond) return u[k] !== cond.$ne
      return u[k] === cond
    })
  const uploads = {
    async get(id: string) {
      return store.find((x) => x._id === id)
    },
    async find({ query }: { query: Record<string, any> }) {
      return store.filter((u) => matches(u, query))
    },
    async patch(id: string, data: Record<string, any>) {
      patchCalls++ // each real patch would fire broadcastUploadChange
      const u = store.find((x) => x._id === id)
      Object.assign(u, data)
      return u
    },
  }
  const app = {
    service(name: string) {
      if (name === 'uploads') return uploads
      throw new Error(`unexpected service: ${name}`)
    },
  }

  const svc = new Service()
  svc.setup(app as any)
  await svc.setRelease({ uploadId: 'target' })

  // Only the 2 rows that actually change get patched: target→released and the
  // previously-live release→obsolete. The 18 unchanged rows and 30 tombstones
  // fire no broadcasts.
  expect(patchCalls).toBe(2)
  expect(store.find((u) => u._id === 'target').status).toBe('released')
  expect(store.find((u) => u._id === 'live').status).toBe('obsolete')

  await fs.promises.rm(tmpRoot, { recursive: true, force: true })
})
