// feathers-blob service
import { hooks } from '@feathersjs/authentication-local'
import * as Err from '@feathersjs/errors'
import dauria from 'dauria'
import blobService from 'feathers-blob'
import * as fs from 'fs'
import fsBlob from 'fs-blob-store'
import multer from 'multer'
import * as unzipper from 'unzipper'

import { getJSONInfo } from '../modules/expo/asset'
import {
  extractPlatforms,
  getUpdateHash,
  getUpdateId,
  parseEmbeddedMetadata,
  replaceExistingEmbedded,
} from '../modules/expo/helpers'
import type { AppLike, HookContextLike, UnknownRecord, UploadRecord } from '../types'

const blobStorage = fsBlob('/uploads')
const multipartMiddleware = multer()
const { protect } = hooks

interface BlobUploadResult extends UnknownRecord {
  id?: string
  contentType?: string
  size?: number
  uploadId?: string
  updateId?: string
  updateHash?: string
  project?: string
  releaseChannel?: string
  message?: string
}

interface UploadHookContext extends HookContextLike {
  result: BlobUploadResult
  data: UnknownRecord
  params: HookContextLike['params'] & {
    headers: Record<string, string | undefined>
    file?: {
      originalname: string
      mimetype: string
      buffer: Buffer
    }
  }
}

const createDocument = async (context: UploadHookContext) => {
  if (!context.result.id || !context.result.size) {
    throw new Err.GeneralError('Upload failed')
  }

  const upload = (await context.app.service('uploads')._create?.({
    createdAt: new Date(),
    originalname: context.params.file.originalname,
    filename: `/uploads/${context.result.id}`,
    size: context.result.size,
    project: context.params.headers.project,
    version: context.params.headers.version,
    releaseChannel: context.params.headers['release-channel'],
    gitBranch: context.params.headers['git-branch'] || 'Unknown',
    gitCommit: context.params.headers['git-commit'] || 'Unknown',
    status: 'ready',
  })) as UploadRecord

  const path = `/updates/${upload.project}/${upload.version}/${upload._id}`
  fs.rmSync(path, { recursive: true, force: true })
  fs.mkdirSync(path, { recursive: true })

  try {
    await fs.createReadStream(upload.filename).pipe(unzipper.Extract({ path })).promise()
  } catch (e) {
    fs.rmSync(upload.filename, { force: true })
    fs.rmSync(path, { recursive: true, force: true })
    context.app.service('uploads').remove(upload._id)
    throw new Err.GeneralError('Error extracting the archive')
  }

  let appJson = null
  let dependencies = null
  let updateId = null
  let updateHash = null
  let embedded = false
  let platform: string | null = null
  let platforms: string[] = []
  try {
    updateHash = getUpdateHash(path)
    const metadataJson = JSON.parse(fs.readFileSync(`${path}/metadata.json`, 'utf-8'))
    const emb = parseEmbeddedMetadata(metadataJson)
    if (emb.embedded) {
      // Embedded from-base: the id is explicit (app.manifest.id, random per
      // native build — the server can't derive it) and the artifact is
      // single-platform. app.json/package.json aren't required (not on the
      // patch path), so skip getJSONInfo. See embedded-ingest contract v1.
      embedded = true
      updateId = emb.updateId
      platform = emb.platform
      platforms = emb.platform ? [emb.platform] : []
    } else {
      const info = getJSONInfo({ path })
      appJson = info.appJson
      dependencies = info.dependencies
      updateId = getUpdateId(path, updateHash)
      platforms = extractPlatforms(metadataJson)
    }
  } catch (e) {
    fs.rmSync(path, { recursive: true, force: true })
    fs.rmSync(upload.filename, { force: true })
    context.app.service('uploads').remove(upload._id)
    // Preserve the specific embedded-validation message (bad updateId, wrong
    // platform count, …); fall back to the generic hint otherwise.
    if (e instanceof Err.BadRequest) throw e
    throw new Err.BadRequest('No metadata.json found, was it included in the zip?')
  }

  if (embedded) {
    // Idempotent per (project, version, releaseChannel, platform, updateId):
    // drop any prior embedded record on this key before finalizing ours, so the
    // partial-unique index holds and rebuilds don't accumulate duplicates.
    await replaceExistingEmbedded(
      context.app.service('uploads'),
      { project: upload.project, version: upload.version, releaseChannel: upload.releaseChannel, platform, updateId },
      upload._id,
    )
  }

  const patchData: UnknownRecord = { path, appJson, dependencies, updateId, updateHash, platforms }
  if (embedded) {
    patchData.embedded = true
    patchData.platform = platform
  }
  await context.app.service('uploads')._patch(upload._id, patchData)

  delete context.result.id
  delete context.result.contentType
  delete context.result.size
  context.result.uploadId = upload._id
  context.result.updateId = updateId
  context.result.updateHash = updateHash
  context.result.project = upload.project
  context.result.releaseChannel = upload.releaseChannel
  context.result.message = 'Upload successful, use the web UI to release id: ' + upload._id

  context.app.service('messages').create({ action: 'update', keys: 'uploads' })
  return context
}

const prepareForUpload = async (context: UploadHookContext) => {
  if (!context.params.headers['release-channel']) {
    throw new Err.BadRequest('Upload failed: missing release-channel header')
  }

  if (context.app.get('uploadKey') !== context.params.headers['upload-key']) {
    throw new Err.BadRequest('Upload failed: missing or wrong upload-key header')
  }

  // Handle multipart content
  if (!context.data.uri && context.params.file) {
    if (context.params.file.originalname.endsWith('.zip')) {
      context.params.file.mimetype = 'application/zip'
    }
    const file = context.params.file
    const uri = dauria.getBase64DataURI(file.buffer, file.mimetype)
    context.data = { uri }
  }
  return context
}

const getHooks = () => ({
  before: {
    all: [],
    find: [],
    get: [],
    create: [prepareForUpload],
    update: [],
    patch: [],
    remove: [],
  },
  after: {
    all: [],
    find: [],
    get: [],
    create: [protect('uri'), createDocument],
    update: [],
    patch: [],
    remove: [],
  },
})

export default (app: AppLike & { use(path: string, ...handlers: unknown[]): void }) => {
  const blob = blobService({ Model: blobStorage })
  const middleware = (req: { feathers: UnknownRecord; file?: unknown }, res: unknown, next: () => void) => {
    req.feathers.file = req.file
    next()
  }

  app.use('/upload', multipartMiddleware.single('uri'), middleware, blob)
  app.service('upload').hooks(getHooks())
}
