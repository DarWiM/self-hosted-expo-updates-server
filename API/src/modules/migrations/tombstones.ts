export type UploadDoc = {
  _id?: unknown
  updateId?: string
  status?: string
  deletedAt?: string | Date | null
}

/**
 * A "flipped tombstone" was soft-deleted (deletedAt is stamped only by the
 * deleteRelease soft-delete, which also sets status 'deleted') but its status
 * is no longer 'deleted' — the signature of the pre-fix setRelease bug.
 */
export function isFlippedTombstone(doc: UploadDoc): boolean {
  return doc.deletedAt != null && doc.status !== 'deleted'
}

/** Mongo translation of isFlippedTombstone ({ $ne: null } excludes missing + explicit null). */
export const FLIPPED_TOMBSTONE_FILTER = {
  deletedAt: { $ne: null },
  status: { $ne: 'deleted' },
}
