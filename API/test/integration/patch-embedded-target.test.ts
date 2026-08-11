// Barrel first to resolve the services circular import (see release.test.ts).
import '../../src/services'

import { expect, test } from 'bun:test'

import patches from '../../src/services/patches'

// Minimal uploads.get/find stand-in. The embedded-target guards fire right
// after the uploads.get() calls, before any Mongo (this.find/create) is touched,
// so no real DB is needed.
function makeApp(byId: Record<string, unknown>) {
  return {
    service(name: string) {
      if (name !== 'uploads') throw new Error(`unexpected service: ${name}`)
      return {
        async get(id: string) {
          return byId[id]
        },
        async find() {
          return []
        },
      }
    },
  }
}

const OTA = { project: 'p', version: '1', releaseChannel: 'prod', updateId: 'uF' }
const EMBEDDED = { project: 'p', version: '1', releaseChannel: 'prod', updateId: 'uE', embedded: true, platform: 'android' }

test('enqueuePatch refuses an embedded target (to)', async () => {
  const svc = patches.createService({})
  svc.app = makeApp({ from: { _id: 'from', ...OTA }, to: { _id: 'to', ...EMBEDDED } }) as any
  await expect(svc.enqueuePatch({ fromUploadId: 'from', toUploadId: 'to' })).rejects.toThrow(/embedded/i)
})

test('enqueuePatch still allows an embedded source (from)', async () => {
  const svc = patches.createService({})
  // from = embedded, to = OTA — this is the whole point of embedded bases, so it
  // must NOT be rejected by the embedded guard (it proceeds to platform logic).
  svc.app = makeApp({
    from: { _id: 'from', ...EMBEDDED },
    to: { _id: 'to', ...OTA, updateId: 'uT' },
  }) as any
  await expect(svc.enqueuePatch({ fromUploadId: 'from', toUploadId: 'to' })).rejects.not.toThrow(/embedded target/i)
})

test('getPatchSources refuses an embedded target (to)', async () => {
  const svc = patches.createService({})
  svc.app = makeApp({ to: { _id: 'to', ...EMBEDDED } }) as any
  await expect(svc.getPatchSources({ toUploadId: 'to' })).rejects.toThrow(/embedded/i)
})
