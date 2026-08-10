import type { Db } from 'mongodb'

import { FLIPPED_TOMBSTONE_FILTER } from '../src/modules/migrations/tombstones'

/**
 * Restore tombstones the pre-fix setRelease bug flipped from 'deleted' to 'obsolete'.
 * Idempotent: a row already 'deleted' no longer matches the filter.
 * Irreversible (no down): the original releasedAt was nulled by the bug and is
 * unrecoverable, so there is nothing to roll back to.
 */
export const up = async (db: Db): Promise<void> => {
  await db.collection('uploads').updateMany(FLIPPED_TOMBSTONE_FILTER, { $set: { status: 'deleted' } })
}
