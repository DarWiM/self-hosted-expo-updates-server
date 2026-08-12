import * as fs from 'fs'
import type { Db } from 'mongodb'

import { extractPlatforms } from '../src/modules/expo/helpers'

const INDEX_NAME = 'updates_listing'

/**
 * Backfill `uploads.platforms` (the ios/android keys present in fileMetadata) so
 * the app-facing GET /api/updates listing can filter by platform without reading
 * each metadata.json off disk on every request. New uploads get it at ingest
 * (upload.ts); this fills existing rows once.
 *
 * Per row:
 *   - embedded from-base → its single stored `platform`
 *   - otherwise → read `${path}/metadata.json` and derive the keys
 *   - unreadable/soft-deleted (no path, files gone) → [] (excluded from listing)
 *
 * Idempotent: only touches rows missing `platforms`; re-runs are no-ops.
 * Also creates the compound index backing the listing query.
 */
export const up = async (db: Db): Promise<void> => {
  await db.collection('uploads').createIndex({ project: 1, version: 1, platforms: 1 }, { name: INDEX_NAME })

  const cursor = db.collection('uploads').find({ platforms: { $exists: false } })
  for await (const upload of cursor) {
    let platforms: string[] = []
    if (upload.embedded && typeof upload.platform === 'string') {
      platforms = [upload.platform]
    } else if (typeof upload.path === 'string' && upload.path) {
      try {
        const metadataJson = JSON.parse(fs.readFileSync(`${upload.path}/metadata.json`, 'utf-8'))
        platforms = extractPlatforms(metadataJson)
      } catch {
        platforms = []
      }
    }
    await db.collection('uploads').updateOne({ _id: upload._id }, { $set: { platforms } })
  }
}

export const down = async (db: Db): Promise<void> => {
  try {
    await db.collection('uploads').dropIndex(INDEX_NAME)
  } catch {
    /* index already gone */
  }
  await db.collection('uploads').updateMany({ platforms: { $exists: true } }, { $unset: { platforms: '' } })
}
