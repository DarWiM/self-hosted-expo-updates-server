import { describe, expect, test } from 'bun:test'

import type { UploadRecord } from '../../types'
import { pickFromUpload } from './asset'

const up = (over: Partial<UploadRecord>): UploadRecord =>
  ({ _id: 'x', updateId: 'u', version: '1.0', releaseChannel: 'production', ...over }) as UploadRecord

describe('pickFromUpload', () => {
  const to = up({ _id: 'to', version: '55.1_dev', releaseChannel: 'production' })

  test('returns the single candidate matching channel + version', () => {
    const from = up({ _id: 'from', version: '55.1_dev', releaseChannel: 'production' })
    expect(pickFromUpload([from], to)).toBe(from)
  })

  test('picks the candidate whose channel matches the target when several share an updateId', () => {
    const preview = up({ _id: 'a', version: '55.1_dev', releaseChannel: 'preview' })
    const production = up({ _id: 'b', version: '55.1_dev', releaseChannel: 'production' })
    expect(pickFromUpload([preview, production], to)).toBe(production)
  })

  test('returns null when only a different-channel candidate exists', () => {
    const preview = up({ _id: 'a', version: '55.1_dev', releaseChannel: 'preview' })
    expect(pickFromUpload([preview], to)).toBeNull()
  })

  test('returns null when the candidate is on a different runtime version', () => {
    const other = up({ _id: 'a', version: '54.0', releaseChannel: 'production' })
    expect(pickFromUpload([other], to)).toBeNull()
  })

  test('returns null for an empty candidate list', () => {
    expect(pickFromUpload([], to)).toBeNull()
  })
})
