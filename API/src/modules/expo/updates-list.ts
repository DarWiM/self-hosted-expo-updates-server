import * as Err from '@feathersjs/errors'

import type { AppLike, AppRecord, UnknownRecord, UploadRecord } from '../../types'

// Header the QA app sends with its per-app read token (validated against
// apps[project].listKey). Deliberately NOT the publish upload-key.
export const LIST_KEY_HEADER = 'x-updates-key'

export interface ParsedCommit {
  hash: string
  subject: string
}

// The publish script sends `git-commit: $(git log --oneline -n 1)`, so the
// stored gitCommit is "<shortHash> <subject>". Split on the first whitespace.
// 'Unknown' is the fallback the API writes when the header is absent — treat it
// as no commit. Mirrors the Web parseCommit so both sides agree on the format.
export const parseCommit = (raw?: string): ParsedCommit | null => {
  const s = (raw || '').trim()
  if (!s || s === 'Unknown') return null
  const idx = s.search(/\s/)
  return idx === -1 ? { hash: s, subject: '' } : { hash: s.slice(0, idx), subject: s.slice(idx + 1).trim() }
}

// Human-readable label for a listing row. Prefer the real commit subject; fall
// back to the branch, then to 'Unknown', so the field is never empty.
export const synthMessage = (commit: ParsedCommit | null, gitBranch?: string): string => {
  if (commit && commit.subject) return commit.subject
  if (gitBranch && gitBranch !== 'Unknown') return gitBranch
  return 'Unknown'
}

export interface UpdateListItem {
  updateId?: string
  runtimeVersion?: string
  platform: string
  platforms: string[]
  createdAt: string | null
  message: string
  gitBranch?: string
  gitCommit?: string
  gitCommitHash: string | null
  gitCommitSubject: string | null
  releaseChannel?: string
  released: boolean
}

const toIso = (value: unknown): string | null => {
  if (!value) return null
  const d = new Date(value as string | number | Date)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const toUpdateListItem = (upload: UploadRecord, platform: string): UpdateListItem => {
  const commit = parseCommit(upload.gitCommit)
  return {
    updateId: upload.updateId,
    runtimeVersion: upload.version,
    platform,
    platforms: Array.isArray(upload.platforms) ? upload.platforms : [],
    createdAt: toIso(upload.createdAt),
    message: synthMessage(commit, upload.gitBranch),
    gitBranch: upload.gitBranch,
    gitCommit: upload.gitCommit,
    gitCommitHash: commit ? commit.hash : null,
    gitCommitSubject: commit ? commit.subject : null,
    releaseChannel: upload.releaseChannel,
    released: upload.status === 'released',
  }
}

// Fail-closed: an app with no listKey configured has its listing locked. We use
// the same 401 for "no app / no token / mismatch" so the endpoint never reveals
// which condition failed.
export const assertListKey = (application: AppRecord | null | undefined, providedKey: unknown): void => {
  const expected = application?.listKey
  if (!expected || typeof expected !== 'string') {
    throw new Err.NotAuthenticated('Listing not authorized')
  }
  if (typeof providedKey !== 'string' || providedKey !== expected) {
    throw new Err.NotAuthenticated('Listing not authorized')
  }
}

const resolvePlatform = (query: UnknownRecord, headers: Record<string, string | undefined>): string => {
  const platform = headers['expo-platform'] ?? query.platform
  if (platform !== 'ios' && platform !== 'android') {
    throw new Err.BadRequest('Missing or invalid platform (expo-platform header or platform query; ios|android).')
  }
  return platform
}

// GET /api/updates?project=&version=&platform= — app-facing update listing.
// Channel-agnostic: filters ONLY by project + runtimeVersion + platform so a
// debug build can see every channel's updates for its runtime. Auth is a
// per-app read token in the x-updates-key header. Returns a plain JSON array
// (no `type` field → the api middleware serialises it as JSON, not a manifest).
export const handleUpdatesList = async (
  app: AppLike,
  { query, headers }: { query: UnknownRecord; headers: Record<string, string | undefined> },
): Promise<UpdateListItem[]> => {
  const project = query.project ?? headers['expo-project']
  if (!project || typeof project !== 'string') {
    throw new Err.BadRequest('No project query or expo-project header provided.')
  }
  const version = query.version ?? headers['expo-runtime-version']
  if (!version || typeof version !== 'string') {
    throw new Err.BadRequest('Missing version query or expo-runtime-version header.')
  }
  const platform = resolvePlatform(query, headers)

  let application: AppRecord | null = null
  try {
    application = (await app.service('apps').get(project)) as AppRecord
  } catch (e) {
    application = null
  }
  assertListKey(application, headers[LIST_KEY_HEADER])

  const updates = (await app.service('uploads').find({
    query: {
      project,
      version,
      embedded: { $ne: true },
      status: { $ne: 'deleted' },
      // Match uploads whose fileMetadata includes this platform. Every servable
      // row carries `platforms` — set at ingest (upload.ts) and backfilled for
      // existing rows by the boot migration — so no $exists fallback is needed
      // (and the feathers adapter rejects $exists on this query anyway).
      platforms: platform,
      $sort: { createdAt: -1 },
    },
  })) as UploadRecord[]

  return updates.map((u) => toUpdateListItem(u, platform))
}
