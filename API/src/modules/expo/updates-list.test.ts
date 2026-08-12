import { describe, expect, test } from 'bun:test'

import type { AppRecord, UploadRecord } from '../../types'
import { assertListKey, parseCommit, synthMessage, toUpdateListItem } from './updates-list'

describe('parseCommit', () => {
  test('splits "<hash> <subject>" on the first whitespace', () => {
    expect(parseCommit('a1b2c3d feat(api): add listing endpoint')).toEqual({
      hash: 'a1b2c3d',
      subject: 'feat(api): add listing endpoint',
    })
  })

  test('subject with extra spaces keeps its internal spacing, trims edges', () => {
    expect(parseCommit('deadbee   fix:  spacing  ')).toEqual({ hash: 'deadbee', subject: 'fix:  spacing' })
  })

  test('hash only (no subject) → empty subject', () => {
    expect(parseCommit('abc1234')).toEqual({ hash: 'abc1234', subject: '' })
  })

  test('"Unknown" and empty/undefined → null', () => {
    expect(parseCommit('Unknown')).toBeNull()
    expect(parseCommit('')).toBeNull()
    expect(parseCommit(undefined)).toBeNull()
    expect(parseCommit('   ')).toBeNull()
  })
})

describe('synthMessage', () => {
  test('prefers the commit subject', () => {
    expect(synthMessage({ hash: 'a1b2c3d', subject: 'feat: x' }, 'develop')).toBe('feat: x')
  })

  test('falls back to branch when subject empty', () => {
    expect(synthMessage({ hash: 'a1b2c3d', subject: '' }, 'develop')).toBe('develop')
  })

  test('falls back to branch when no commit', () => {
    expect(synthMessage(null, 'main')).toBe('main')
  })

  test('"Unknown"/absent branch with no subject → "Unknown"', () => {
    expect(synthMessage(null, 'Unknown')).toBe('Unknown')
    expect(synthMessage(null, undefined)).toBe('Unknown')
    expect(synthMessage({ hash: 'x', subject: '' }, undefined)).toBe('Unknown')
  })
})

describe('toUpdateListItem', () => {
  const base: UploadRecord = {
    _id: '1',
    updateId: 'u-1',
    version: '55.1_dev',
    releaseChannel: 'production',
    status: 'released',
    createdAt: '2026-08-13T10:00:00.000Z',
    gitBranch: 'develop',
    gitCommit: 'a1b2c3d feat(api): listing',
    platforms: ['ios', 'android'],
  }

  test('maps all fields, echoes requested platform, released = status===released', () => {
    expect(toUpdateListItem(base, 'ios')).toEqual({
      updateId: 'u-1',
      runtimeVersion: '55.1_dev',
      platform: 'ios',
      platforms: ['ios', 'android'],
      createdAt: '2026-08-13T10:00:00.000Z',
      message: 'feat(api): listing',
      gitBranch: 'develop',
      gitCommit: 'a1b2c3d feat(api): listing',
      gitCommitHash: 'a1b2c3d',
      gitCommitSubject: 'feat(api): listing',
      releaseChannel: 'production',
      released: true,
    })
  })

  test('non-released status → released:false; parsed commit fields null when Unknown', () => {
    const item = toUpdateListItem({ ...base, status: 'ready', gitCommit: 'Unknown' }, 'android')
    expect(item.released).toBe(false)
    expect(item.gitCommitHash).toBeNull()
    expect(item.gitCommitSubject).toBeNull()
    expect(item.message).toBe('develop')
    expect(item.platform).toBe('android')
  })

  test('missing platforms → empty array; Date createdAt normalised to ISO', () => {
    const item = toUpdateListItem(
      { _id: '2', createdAt: new Date('2026-01-01T00:00:00.000Z') } as UploadRecord,
      'ios',
    )
    expect(item.platforms).toEqual([])
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('assertListKey', () => {
  const app = (listKey?: string): AppRecord => ({ _id: 'petsee', listKey }) as AppRecord

  test('passes when header matches the app token', () => {
    expect(() => assertListKey(app('secret-token'), 'secret-token')).not.toThrow()
  })

  test('throws 401 when token mismatches', () => {
    expect(() => assertListKey(app('secret-token'), 'wrong')).toThrow('Listing not authorized')
  })

  test('throws 401 when app has no token configured (fail-closed)', () => {
    expect(() => assertListKey(app(undefined), 'anything')).toThrow('Listing not authorized')
  })

  test('throws 401 when app is missing entirely', () => {
    expect(() => assertListKey(null, 'anything')).toThrow('Listing not authorized')
  })

  test('throws 401 when no header is provided even if a token exists', () => {
    expect(() => assertListKey(app('secret-token'), undefined)).toThrow('Listing not authorized')
  })
})
