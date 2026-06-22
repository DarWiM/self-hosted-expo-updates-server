import * as fs from 'fs'
import * as path from 'path'

import { getMetadataAsync, getUpdateHashAsync } from './helpers'
import { getLaunchAssetPathAsync } from './patch'

const canAccess = async (p, mode) => {
  try {
    await fs.promises.access(p, mode)
    return true
  } catch (e) {
    return false
  }
}
const isReadable = (p) => canAccess(p, fs.constants.R_OK)
const pathExists = (p) => canAccess(p, fs.constants.F_OK)

/**
 * Inspect a single upload document and return its integrity issues.
 * Issue shape: { severity: 'error' | 'warning', category: string, message: string }
 *
 * All filesystem access is async (libuv threadpool) so this never blocks the
 * main event loop — the asset hot path and admin walks await it.
 *
 * Used by:
 *   - the full project-wide integrity walk (utils.checkIntegrity)
 *   - the pre-flight guard in utils.setRelease
 *   - the asset endpoint patch flow (refuses to serve / queue a patch
 *     for broken bundles)
 *   - the patches worker (refuses to generate patches between broken bundles)
 */
export const checkSingleIntegrity = async (up) => {
  const issues = []
  const err = (category, message) => issues.push({ severity: 'error', category, message })
  const warn = (category, message) => issues.push({ severity: 'warning', category, message })

  if (!up.filename) err('zip', 'zip path not recorded in DB')
  else if (!(await pathExists(up.filename))) err('zip', 'zip archive missing on disk')
  else if (!(await isReadable(up.filename))) err('zip', 'zip archive not readable (permission)')

  const hasDir = !!up.path && (await pathExists(up.path))
  if (!up.path) err('dir', 'extracted path not recorded in DB')
  else if (!hasDir) err('dir', 'extracted directory missing on disk')
  else if (!(await isReadable(up.path))) err('dir', 'extracted directory not readable (permission)')

  if (!up.updateId) warn('db', 'updateId missing in DB')
  if (!up.updateHash) warn('db', 'updateHash missing in DB')

  if (hasDir && (await isReadable(up.path))) {
    let metadata = null
    try {
      ;({ metadataJson: metadata } = await getMetadataAsync(up))
    } catch (e) {
      err('metadata', `metadata.json: ${e.message}`)
    }

    const appJsonPath = path.join(up.path, 'app.json')
    if (!(await pathExists(appJsonPath))) err('app-json', 'app.json missing')
    else if (!(await isReadable(appJsonPath))) err('app-json', 'app.json not readable')
    else {
      try {
        JSON.parse(await fs.promises.readFile(appJsonPath, 'utf-8'))
      } catch (e) {
        err('app-json', `app.json invalid JSON: ${e.message}`)
      }
    }

    const pkgPath = path.join(up.path, 'package.json')
    if (!(await pathExists(pkgPath))) err('package-json', 'package.json missing')
    else if (!(await isReadable(pkgPath))) err('package-json', 'package.json not readable')
    else {
      try {
        JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'))
      } catch (e) {
        err('package-json', `package.json invalid JSON: ${e.message}`)
      }
    }

    if (metadata && up.updateHash) {
      try {
        const computed = await getUpdateHashAsync(up.path)
        if (computed !== up.updateHash) {
          err('hash', `updateHash drift (db=${up.updateHash.slice(0, 12)}…, fs=${computed.slice(0, 12)}…)`)
        }
      } catch (e) {
        /* metadata read already reported */
      }
    }

    if (metadata?.fileMetadata) {
      for (const platform of ['ios', 'android']) {
        const platMeta = metadata.fileMetadata[platform]
        if (!platMeta) continue

        let bundleFull = null
        try {
          bundleFull = await getLaunchAssetPathAsync(up, platform)
        } catch (e) {
          err('bundle', `${platform} bundle: ${e.message}`)
        }

        if (bundleFull) {
          if (!(await pathExists(bundleFull))) err('bundle', `${platform} bundle missing`)
          else if (!(await isReadable(bundleFull))) err('bundle', `${platform} bundle not readable (permission)`)
          else {
            try {
              const st = await fs.promises.stat(bundleFull)
              if (st.size === 0) err('bundle', `${platform} bundle is empty (0 bytes)`)
            } catch (e) {
              /* unlikely */
            }
          }
        }

        const assets = platMeta.assets || []
        const present = await Promise.all(assets.map((asset) => pathExists(path.join(up.path, asset.path))))
        const missingAssetCount = present.filter((ok) => !ok).length
        if (missingAssetCount > 0) {
          err('asset', `${platform}: ${missingAssetCount} asset file(s) missing`)
        }
      }
    }
  }

  return {
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
  }
}

/**
 * Narrower check: does this upload have an error that would make a launch
 * bundle for the given platform broken? Used by asset/patch flows so we
 * don't fail on iOS issues when an Android client is asking.
 */
export const isLaunchBundleHealthy = async (up, platform) => {
  const { issues } = await checkSingleIntegrity(up)
  const blocking = issues.filter((i) => {
    if (i.severity !== 'error') return false
    // Categories that affect bundle serving regardless of platform:
    if (['zip', 'dir', 'metadata'].includes(i.category)) return true
    // Bundle category: only block if message mentions our platform.
    if (i.category === 'bundle') return i.message.toLowerCase().includes(platform)
    // Other categories (app-json, package-json, hash, asset) don't break the
    // launch bundle stream itself — clients can still receive bytes.
    return false
  })
  return { healthy: blocking.length === 0, blocking }
}
