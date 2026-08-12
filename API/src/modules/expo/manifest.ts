import * as Err from '@feathersjs/errors'
import FormData from 'form-data'
import { serializeDictionary } from 'structured-headers'

import { convertToDictionaryItemsRepresentation, getAssetMetadataSync, getMetadataSync, signRSASHA256 } from './helpers'
import { getRequestParams } from './request'
import { assertListKey, LIST_KEY_HEADER } from './updates-list'

const getSignature = async ({ headers, manifest, privateKey }) => {
  const expectSignatureHeader = !!headers['expo-expect-signature']
  if (!expectSignatureHeader) return {}

  if (!privateKey) {
    throw new Err.BadRequest('Code signing requested but no key supplied when starting server.')
  }
  const manifestString = JSON.stringify(manifest)
  const hashSignature = signRSASHA256(manifestString, privateKey)
  const dictionary = convertToDictionaryItemsRepresentation({
    sig: hashSignature,
    keyid: 'main',
  })
  return { 'expo-signature': serializeDictionary(dictionary) }
}

export const hanldeManifestData = async (app, { query, headers }) => {
  let update
  let platform
  let runtimeVersion

  if (query.updateId) {
    // Manifest-by-id (QA): resolve a specific update by its id, channel-agnostic
    // and regardless of release status, so a debug build can load any build on
    // its runtime. Embedded from-bases (no asset manifest) and soft-deleted rows
    // (files gone) are excluded. runtimeVersion/project come from the record.
    // Key-gated below (same per-app listKey as the listing).
    platform = query.platform ?? headers['expo-platform']
    if (platform !== 'ios' && platform !== 'android') {
      throw new Err.BadRequest('Missing or invalid platform (expo-platform header or platform query; ios|android).')
    }
    const matches = await app
      .service('uploads')
      .find({ query: { updateId: query.updateId, embedded: { $ne: true }, status: { $ne: 'deleted' }, $limit: 1 } })
    update = matches?.[0]
    if (!update) throw new Err.NotFound(`No update found for updateId ${query.updateId}`)
    runtimeVersion = update.version
  } else {
    const params = getRequestParams({ query, headers })
    platform = params.platform
    runtimeVersion = params.runtimeVersion
    const [released] = await app
      .service('uploads')
      .find({ query: { project: params.project, version: runtimeVersion, releaseChannel: params.releaseChannel, status: 'released' } })
    update = released
  }
  if (!update) return { message: 'No uploads found' }

  const application = await app.service('apps').get(update.project)
  // Manifest-by-id is key-gated (fail-closed 401): loadApp() can't send custom
  // headers, so the token rides in the `key` query param; an x-updates-key header
  // is also accepted. The legacy channel+runtime path (no updateId) stays public
  // and untouched — it serves normal OTA to released apps.
  if (query.updateId) {
    assertListKey(application, query.key ?? headers[LIST_KEY_HEADER])
  }
  if (!application) return { message: 'No application found' }

  try {
    const { metadataJson, createdAt } = getMetadataSync(update)

    const platformSpecificMetadata = metadataJson.fileMetadata[platform]
    if (!platformSpecificMetadata) {
      throw new Err.NotFound(`Update has no ${platform} bundle`)
    }
    const manifest = {
      id: update.updateId,
      createdAt,
      runtimeVersion,
      assets: platformSpecificMetadata.assets.map((asset) =>
        getAssetMetadataSync({
          update,
          filePath: asset.path,
          ext: asset.ext,
          runtimeVersion,
          platform,
          isLaunchAsset: false,
        }),
      ),
      launchAsset: getAssetMetadataSync({
        update,
        filePath: platformSpecificMetadata.bundle,
        isLaunchAsset: true,
        runtimeVersion,
        platform,
        ext: null,
      }),
      metadata: {},
      extra: {
        expoClient: update.appJson,
      },
    }

    const assetRequestHeaders = {}
    ;[...manifest.assets, manifest.launchAsset].forEach((asset) => {
      assetRequestHeaders[asset.key] = {
        'test-header': 'test-header-value',
      }
    })

    const form = new FormData()

    form.append('manifest', JSON.stringify(manifest), {
      contentType: 'application/json',
      header: {
        'content-type': 'application/json; charset=utf-8',
        ...(await getSignature({ headers, manifest, privateKey: application.privateKey })),
      },
    })

    form.append('extensions', JSON.stringify({ assetRequestHeaders }), {
      contentType: 'application/json',
    })

    return {
      type: 'manifest',
      formBoundary: form.getBoundary(),
      formData: form.getBuffer().toString(),
    }
  } catch (error) {
    // Preserve real HTTP errors (e.g. 404 for a missing update / platform)
    // instead of masking them as a 400 with a stringified body.
    if (error instanceof Err.FeathersError) throw error
    throw new Err.BadRequest(JSON.stringify(error))
  }
}

export const handleManifestResponse = (res, protocolVersion) => {
  res.set('expo-protocol-version', protocolVersion ?? 0)
  res.set('expo-sfv-version', 0)
  res.set('cache-control', 'private, max-age=0')
  res.set('content-type', `multipart/mixed; boundary=${res.data.formBoundary}`)
  const buffer = Buffer.from(res.data.formData)
  res.write(buffer)
  res.end()
}
