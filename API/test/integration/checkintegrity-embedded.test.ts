// Barrel first to resolve the utils <-> services circular import (see release.test.ts).
import '../../src/services'

import { afterEach, beforeEach, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { Service } from '../../src/services/utils'

let tmp: string
let dir: string
let zip: string

beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'checkintegrity-embedded-'))
  dir = path.join(tmp, 'extracted')
  zip = path.join(tmp, 'artifact.zip')
  await fs.promises.mkdir(dir, { recursive: true })
  // metadata references an android bundle that is NOT on disk → bundle error,
  // so this (otherwise embedded-clean) record shows up in problems[].
  await fs.promises.writeFile(
    path.join(dir, 'metadata.json'),
    JSON.stringify({ fileMetadata: { android: { bundle: 'bundles/missing', assets: [] } } }),
  )
  await fs.promises.writeFile(zip, 'zip-bytes')
})
afterEach(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true })
})

function makeApp(uploads: unknown[]) {
  return {
    service(name: string) {
      if (name !== 'uploads') throw new Error(`unexpected service: ${name}`)
      return {
        async find() {
          return uploads
        },
      }
    },
  }
}

test('checkIntegrity surfaces the embedded flag + platform on problem rows', async () => {
  const up = {
    _id: 'e',
    project: 'p',
    embedded: true,
    platform: 'android',
    path: dir,
    filename: zip,
    updateId: 'a10096be-14e3-47da-8d1c-9bebb61c9932',
    version: '1',
    releaseChannel: 'prod',
    status: 'ready',
    createdAt: new Date().toISOString(),
  }

  const svc = new Service()
  svc.setup(makeApp([up]) as any)

  const res = await svc.checkIntegrity({ project: 'p' })
  expect(res.problems.length).toBe(1)
  expect(res.problems[0].embedded).toBe(true)
  expect(res.problems[0].platform).toBe('android')
})
