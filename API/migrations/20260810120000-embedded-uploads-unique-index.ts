import type { Db } from 'mongodb'

const INDEX_NAME = 'uniq_embedded_from_base'

/**
 * Enforce embedded-ingest idempotency at the DB layer: one embedded from-base
 * per (project, version, releaseChannel, platform, updateId). Partial over
 * `embedded: true` so normal OTA uploads — which have no platform/updateId
 * uniqueness and may legitimately repeat that triple — are untouched.
 * Idempotent: createIndex with the same spec+options is a no-op on re-run.
 */
export const up = async (db: Db): Promise<void> => {
  await db
    .collection('uploads')
    .createIndex(
      { project: 1, version: 1, releaseChannel: 1, platform: 1, updateId: 1 },
      { unique: true, partialFilterExpression: { embedded: true }, name: INDEX_NAME },
    )
}

export const down = async (db: Db): Promise<void> => {
  await db.collection('uploads').dropIndex(INDEX_NAME)
}
