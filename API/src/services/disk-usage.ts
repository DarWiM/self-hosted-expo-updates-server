import * as fs from 'fs'
import * as path from 'path'

import s from '../hooks/security'
import { logger } from '../modules'
import { PATCH_DIR_NAME } from '../modules/expo/patch'
import type { AppLike, UnknownRecord } from '../types'
import { getServerSettings } from './server-settings'

const DEFAULT_CACHE_TTL_MS = 30 * 1000
const UPDATES_ROOT = process.env.UPDATES_ROOT || '/updates'
const DISK_STAT_PATH = process.env.DISK_STAT_PATH || UPDATES_ROOT
let loggedStatOnce = false

let cache = null
let cacheAt = 0

const pathExists = async (p: string) => {
  try {
    await fs.promises.access(p)
    return true
  } catch (e) {
    return false
  }
}

const dirSize = async (dir) => {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch (e) {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      try {
        if (entry.isDirectory()) stack.push(full)
        else if (entry.isFile()) total += (await fs.promises.stat(full)).size
      } catch (e) {
        /* ignore transient FS errors */
      }
    }
  }
  return total
}

const computeSizes = async () => {
  // Walk UPDATES_ROOT splitting bytes between "regular" update bundles and
  // anything living inside a PATCH_DIR_NAME subfolder (bsdiff patch files).
  // Each upload has its own optional ._patches/ inside its extracted dir.
  // Async fs keeps the walk off the main event loop under load.
  let updatesBytes = 0
  let patchesBytes = 0

  const walk = async (dir) => {
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === PATCH_DIR_NAME) {
          patchesBytes += await dirSize(full)
        } else {
          await walk(full)
        }
      } else if (entry.isFile()) {
        try {
          updatesBytes += (await fs.promises.stat(full)).size
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  if (await pathExists(UPDATES_ROOT)) await walk(UPDATES_ROOT)

  let totalBytes = 0
  let freeBytes = 0
  const statfsAsync = typeof fs.promises.statfs === 'function'
  try {
    // Single call (no loop cost). Prefer the async API; fall back to sync on
    // runtimes that don't expose fs.promises.statfs (older Bun builds).
    const stat = statfsAsync ? await fs.promises.statfs(DISK_STAT_PATH) : fs.statfsSync(DISK_STAT_PATH)
    totalBytes = stat.blocks * stat.bsize
    freeBytes = stat.bavail * stat.bsize
    if (!loggedStatOnce) {
      loggedStatOnce = true
      logger.info('disk-usage: statfs', {
        path: DISK_STAT_PATH,
        bsize: stat.bsize,
        blocks: stat.blocks,
        bfree: stat.bfree,
        bavail: stat.bavail,
        totalBytes,
        freeBytes,
      })
    }
  } catch (e) {
    logger.warn('disk-usage: statfs failed', { path: DISK_STAT_PATH, error: e.message })
  }
  const usedBytes = totalBytes > 0 ? totalBytes - freeBytes : 0

  return {
    updatesBytes,
    patchesBytes,
    totalBytes,
    freeBytes,
    usedBytes,
    computedAt: new Date(),
  }
}

class Service {
  options: UnknownRecord
  app: AppLike
  constructor(options?: UnknownRecord) {
    this.options = options || {}
  }
  setup(app: AppLike) {
    this.app = app
  }

  async find() {
    return this.get()
  }

  async get() {
    const now = Date.now()
    // Cache window is live-configurable (server-settings.diskUsageCacheMs);
    // getServerSettings never throws and falls back to defaults.
    let ttlMs = DEFAULT_CACHE_TTL_MS
    try {
      ttlMs = (await getServerSettings(this.app)).diskUsageCacheMs
    } catch (e) {
      /* keep default */
    }
    if (cache && now - cacheAt < ttlMs) return cache
    cache = await computeSizes()
    cacheAt = now
    return cache
  }
}

export default {
  name: 'disk-usage',
  createService: (options?: UnknownRecord) => new Service(options),
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [s.methodNotAllowed],
      update: [s.methodNotAllowed],
      patch: [s.methodNotAllowed],
      remove: [s.methodNotAllowed],
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: [],
    },
  },
}
