// MongoDB duplicate-key error (E11000): a unique-index violation — surfaces when
// an insert collides with an existing _id or other unique field.
export const MONGODB_DUPLICATE_KEY = 11000

// Detect a duplicate-key violation. Some driver/wrapper paths report it without a
// numeric `.code`, so we also match the message text (the defensive check the
// asset enqueue path already relied on).
export function isDuplicateKeyError(e: unknown): boolean {
  const err = e as { code?: number; message?: string } | null | undefined
  return err?.code === MONGODB_DUPLICATE_KEY || String(err?.message || '').includes('duplicate key')
}
