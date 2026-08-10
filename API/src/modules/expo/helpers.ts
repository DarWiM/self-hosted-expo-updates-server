import * as Err from '@feathersjs/errors'
import * as crypto from 'crypto'
import * as fs from 'fs'
import mimeModule from 'mime'
import * as path from 'path'

import type { AssetMetadataOptions, MetadataResult, UnknownRecord, UploadRecord } from '../../types'

const mime = mimeModule

function createHash(file, hashingAlgorithm, encoding) {
  return crypto.createHash(hashingAlgorithm).update(file).digest(encoding)
}

function getBase64URLEncoding(base64EncodedString) {
  return base64EncodedString.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const convertToDictionaryItemsRepresentation = (
  obj: UnknownRecord,
): Map<string, [unknown, Map<string, unknown>]> => {
  return new Map(Object.entries(obj).map(([k, v]) => [k, [v, new Map()] as [unknown, Map<string, unknown>]]))
}

export const signRSASHA256 = (data, privateKey) => {
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(data, 'utf8')
  sign.end()
  return sign.sign(privateKey, 'base64')
}

export const getPrivateKeyAsync = async () => {
  const privateKeyPath = process.env.PRIVATE_KEY_PATH
  if (!privateKeyPath) return null

  let pemBuffer: Buffer
  try {
    pemBuffer = fs.readFileSync(path.resolve(privateKeyPath))
    return pemBuffer.toString('utf8')
  } catch (e) {
    return false
  }
}

// Asset files are immutable within an upload, but the manifest endpoint is hit
// by every client on every launch — recomputing sha256+md5 over every asset
// (including the multi-MB launch bundle) on each request blocks the event loop.
// Cache the file-derived hashes keyed by path + size + mtime; the stat guard is
// microseconds vs. reading and hashing megabytes, and invalidates if a path is
// ever reused with different bytes. LRU-capped so memory can't grow unbounded.
const HASH_CACHE_MAX = Number(process.env.ASSET_HASH_CACHE_MAX) || 5000
const hashCache = new Map<string, { hash: string; key: string }>()

const getAssetHashesCached = (resolvedPath: string): { hash: string; key: string } => {
  const stat = fs.statSync(resolvedPath)
  const cacheKey = `${resolvedPath}:${stat.size}:${stat.mtimeMs}`
  const hit = hashCache.get(cacheKey)
  if (hit) {
    // Refresh recency: re-insert moves the entry to the end of the Map.
    hashCache.delete(cacheKey)
    hashCache.set(cacheKey, hit)
    return hit
  }
  const asset = fs.readFileSync(resolvedPath, null)
  const value = {
    hash: getBase64URLEncoding(createHash(asset, 'sha256', 'base64')),
    key: createHash(asset, 'md5', 'hex'),
  }
  hashCache.set(cacheKey, value)
  if (hashCache.size > HASH_CACHE_MAX) {
    hashCache.delete(hashCache.keys().next().value) // evict least-recently used
  }
  return value
}

export const getAssetMetadataSync = ({ update, filePath, ext, isLaunchAsset, platform }: AssetMetadataOptions) => {
  const normalizedFilePath = path.normalize(filePath).replace(/\\/g, '/')
  const assetFilePath = path.join(update.path, normalizedFilePath)
  const { hash: assetHash, key } = getAssetHashesCached(path.resolve(assetFilePath))
  const keyExtensionSuffix = isLaunchAsset ? 'bundle' : ext
  const contentType = isLaunchAsset ? 'application/javascript' : mime.getType(ext)

  const baseUrl = `${process.env.PUBLIC_URL}/api/assets?asset=${assetFilePath}&contentType=${encodeURI(contentType)}&platform=${platform}`
  // Launch assets need to know which (project, updateId) they're being
  // served as so the patch flow on the server can look up patches between
  // the client's currentUpdateId and this one.
  const url = isLaunchAsset
    ? `${baseUrl}&project=${encodeURIComponent(update.project)}&updateId=${encodeURIComponent(update.updateId)}`
    : baseUrl

  return {
    hash: assetHash,
    key,
    fileExtension: `.${keyExtensionSuffix}`,
    contentType,
    url,
  }
}

// Manifest timestamp prefers releasedAt, but unreleased uploads (and the
// pre-flight integrity guard that runs *before* release) have none — fall back
// to createdAt, then to now, so `new Date(...).toISOString()` never throws
// `RangeError: Invalid Date` and blocks the release. See issue #48.
const resolveManifestTimestamp = (update: UploadRecord): string => {
  for (const candidate of [update.releasedAt, update.createdAt]) {
    if (!candidate) continue
    const d = new Date(candidate)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

export const getMetadataSync = (update: UploadRecord): MetadataResult => {
  try {
    const metadataPath = `${update.path}/metadata.json`
    const updateMetadataBuffer = fs.readFileSync(path.resolve(metadataPath), null)
    const metadataJson = JSON.parse(updateMetadataBuffer.toString('utf-8'))

    return {
      metadataJson,
      createdAt: resolveManifestTimestamp(update),
    }
  } catch (error) {
    throw new Error(`No update found with runtime version: ${update.version}. Error: ${error}`)
  }
}

// Async sibling of getMetadataSync. Used by the integrity / admin-walk paths
// that run on the main event loop, so the metadata.json read happens on the
// libuv threadpool instead of blocking. getMetadataSync stays for the manifest
// hot path and the patch worker thread.
export const getMetadataAsync = async (update: UploadRecord): Promise<MetadataResult> => {
  try {
    const metadataPath = path.resolve(`${update.path}/metadata.json`)
    const updateMetadataBuffer = await fs.promises.readFile(metadataPath)
    const metadataJson = JSON.parse(updateMetadataBuffer.toString('utf-8'))
    return {
      metadataJson,
      createdAt: resolveManifestTimestamp(update),
    }
  } catch (error) {
    throw new Error(`No update found with runtime version: ${update.version}. Error: ${error}`)
  }
}

const convertSHA256HashToUUID = (value) => {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`
}

export { convertSHA256HashToUUID }

const getUpdateHash = (pathToUpdate) => {
  const metadataPath = `${pathToUpdate}/metadata.json`
  const updateMetadataBuffer = fs.readFileSync(path.resolve(metadataPath), null)
  return createHash(updateMetadataBuffer, 'sha256', 'hex')
}

export { getUpdateHash }

const getUpdateHashAsync = async (pathToUpdate) => {
  const metadataPath = path.resolve(`${pathToUpdate}/metadata.json`)
  const updateMetadataBuffer = await fs.promises.readFile(metadataPath)
  return createHash(updateMetadataBuffer, 'sha256', 'hex')
}

export { getUpdateHashAsync }

const getUpdateId = (pathToUpdate, updateHash) => {
  const combined = pathToUpdate + updateHash
  const id = createHash(combined, 'sha256', 'hex')
  return convertSHA256HashToUUID(id)
}

export { getUpdateId }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMBEDDED_PLATFORMS: readonly string[] = ['ios', 'android']

export interface EmbeddedMetadata {
  embedded: boolean
  updateId?: string
  platform?: string
}

// An embedded artifact self-describes via metadata.json: `embedded: true`, an
// explicit `updateId` (= app.manifest.id, a random UUID minted per native build,
// which the server cannot re-derive), and a single-platform fileMetadata. See
// the embedded-ingest contract v1. Non-embedded metadata returns
// { embedded: false } so the caller keeps the normal server-derived-id path.
export const parseEmbeddedMetadata = (metadataJson: unknown): EmbeddedMetadata => {
  const meta = (metadataJson ?? {}) as Record<string, unknown>
  if (meta.embedded !== true) return { embedded: false }

  const updateId = meta.updateId
  if (typeof updateId !== 'string' || !UUID_RE.test(updateId)) {
    throw new Err.BadRequest('Embedded upload: metadata.updateId must be a UUID (from app.manifest.id)')
  }

  const fileMetadata = (meta.fileMetadata ?? {}) as Record<string, unknown>
  const keys = Object.keys(fileMetadata)
  if (keys.length !== 1) {
    throw new Err.BadRequest('Embedded upload: metadata.fileMetadata must contain exactly one platform')
  }
  const platform = keys[0]
  if (!EMBEDDED_PLATFORMS.includes(platform)) {
    throw new Err.BadRequest(`Embedded upload: unknown platform "${platform}" (expected ios or android)`)
  }

  return { embedded: true, updateId, platform }
}

interface UploadsFindRemove {
  find(params: { query: UnknownRecord }): Promise<unknown>
  remove(id: unknown): Promise<unknown>
}

// Embedded ingest is idempotent per (project, version, releaseChannel, platform,
// updateId): a rebuild shipping the same bytes re-uploads under the same explicit
// id. Replace-on-ingest — delete any prior embedded record on that exact key (its
// extracted dir + zip on disk, then the row) so duplicates never accumulate and
// the partial-unique index over that key stays satisfiable. `keepId` is the
// freshly-created upload we're finalizing; never touch it.
export const replaceExistingEmbedded = async (
  uploads: UploadsFindRemove,
  key: { project?: string; version?: string; releaseChannel?: string; platform?: string; updateId?: string },
  keepId: unknown,
): Promise<{ removed: number }> => {
  const found = await uploads.find({ query: { ...key, embedded: true } })
  const list = (Array.isArray(found) ? found : (found as { data?: UploadRecord[] })?.data || []) as UploadRecord[]
  let removed = 0
  for (const old of list) {
    if (String(old._id) === String(keepId)) continue
    if (old.path) fs.rmSync(old.path, { recursive: true, force: true })
    if (old.filename) fs.rmSync(old.filename, { force: true })
    await uploads.remove(old._id)
    removed++
  }
  return { removed }
}
