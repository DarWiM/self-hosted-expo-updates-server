import { expect, test } from 'bun:test'

import { computePending, parseMigrationName } from './runner'

test('parseMigrationName splits the 14-digit timestamp from the name', () => {
  expect(parseMigrationName('20260629120000-repair-flipped-tombstones.ts')).toEqual({
    timestamp: '20260629120000',
    name: 'repair-flipped-tombstones',
  })
})

test('parseMigrationName rejects malformed filenames', () => {
  const bad = [
    'repair.ts', // no timestamp
    '2026062912000-foo.ts', // 13-digit timestamp
    '202606291200000-foo.ts', // 15-digit timestamp
    '20260629120000-FooBar.ts', // uppercase in name
    '20260629120000-foo', // missing .ts extension
    '20260629120000--bad.ts', // leading/double hyphen in name
    '20260629120000-bad-.ts', // trailing hyphen in name
  ]
  for (const name of bad) {
    expect(() => parseMigrationName(name)).toThrow('Invalid migration filename')
  }
})

test('computePending returns only unapplied files, sorted ascending', () => {
  const files = ['20260101000000-b.ts', '20250101000000-a.ts', '20270101000000-c.ts']
  const applied = ['20250101000000-a.ts']
  expect(computePending(applied, files)).toEqual(['20260101000000-b.ts', '20270101000000-c.ts'])
})
