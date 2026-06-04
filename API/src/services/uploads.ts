import s from '../hooks/security'
import { logger } from '../modules'
import { deletePatchFile } from '../modules/expo/patch'
import type { HookContextLike, PatchRecord, UploadRecord } from '../types'
import { idMatch } from './lib/list-query'

const broadcastUploadChange = (context: HookContextLike) => {
  const result = context.result as UploadRecord | UploadRecord[] | undefined
  const rows = Array.isArray(result) ? result : result ? [result] : []
  const projects = new Set<string>()
  for (const row of rows) {
    if (typeof row?.project === 'string') projects.add(row.project)
  }
  const keys: Array<string | string[]> = ['uploads', 'published']
  for (const project of projects) keys.push(['stats', project], ['adoption', project])
  context.app.service('messages').create({ action: 'update', keys })
  return context
}

// When an upload is deleted, walk every patch that references it (as
// either from or to) and remove the patch file + DB row. Otherwise stale
// patches would linger on disk pointing at a missing source/target bundle.
const cascadeRemovePatches = async (context: HookContextLike) => {
  if (!context.id) return context
  try {
    const patches = context.app.service('patches')
    const id = idMatch(context.id)
    const related = await patches.find({
      query: {
        $or: [{ fromUploadId: id }, { toUploadId: id }],
        $limit: 1000,
      },
    })
    const docs = Array.isArray(related) ? (related as PatchRecord[]) : (related as { data?: PatchRecord[] })?.data || []
    for (const doc of docs) {
      deletePatchFile(doc.path)
      try {
        await patches.remove(doc._id, { reason: 'upload-removed' })
      } catch (e) {
        /* already gone */
      }
    }
    // Drop any from→to pairs left with no patches after the cascade.
    if (docs.length) {
      await context.app.service('patch-pairs').pruneEmpty?.()
    }
  } catch (e) {
    logger.warn('uploads.cascadeRemovePatches: failed', {
      id: context.id,
      error: e instanceof Error ? e.message : String(e),
    })
  }
  return context
}

export default {
  name: 'uploads',
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: [cascadeRemovePatches],
    },

    after: {
      all: [],
      find: [],
      get: [],
      create: [broadcastUploadChange],
      update: [broadcastUploadChange],
      patch: [broadcastUploadChange],
      remove: [broadcastUploadChange],
    },
  },
}
