import { expect, test } from 'bun:test'

import { isFlippedTombstone } from './tombstones'

test('detects a soft-deleted row whose status was flipped away from deleted', () => {
  expect(isFlippedTombstone({ status: 'obsolete', deletedAt: '2021-06-01T00:00:00.000Z' })).toBe(true)
})

test('leaves a correct tombstone (status still deleted) untouched', () => {
  expect(isFlippedTombstone({ status: 'deleted', deletedAt: '2021-06-01T00:00:00.000Z' })).toBe(false)
})

test('does not touch a legitimately obsolete row that was never soft-deleted', () => {
  expect(isFlippedTombstone({ status: 'obsolete' })).toBe(false)
  expect(isFlippedTombstone({ status: 'obsolete', deletedAt: null })).toBe(false)
})

test('does not touch ready or released rows', () => {
  expect(isFlippedTombstone({ status: 'ready' })).toBe(false)
  expect(isFlippedTombstone({ status: 'released' })).toBe(false)
})
