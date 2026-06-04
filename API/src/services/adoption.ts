import moment from 'moment'

import s from '../hooks/security'
import type { AppLike, ClientRecord, UnknownRecord, UploadRecord } from '../types'

// How recently a client must have been seen to count as "active". Older
// clients are treated as gone (uninstalled / dormant), not as failures.
const DEFAULT_ACTIVE_WINDOW_DAYS = 7
// Grace after a release before a still-not-updated active client counts as a
// rollback-suspect. expo-updates downloads in the background and applies on the
// NEXT cold start, so without this every client looks "stuck" right after a
// release. Sized to cover a typical relaunch cycle.
const DEFAULT_GRACE_HOURS = 24
// Cap on how many suspect rows we return per bucket (the count is exact; the
// list is a sample so the response stays bounded for noisy releases).
const SUSPECT_SAMPLE_CAP = 50

interface Suspect {
  clientId?: string
  platform?: string
  currentUpdate?: string
  lastSeen?: string | Date
  updateCount?: number
}

interface AdoptionBucket {
  version?: string
  platform?: string
  releaseChannel?: string
  releasedUpdateId?: string
  releasedAt?: string | Date
  activeDevices: number
  onLatest: number
  onOlderOTA: number
  // Devices running an update NEWER than the currently-released one — i.e. they
  // adopted an update that was later rolled back/pulled by an admin. Expected
  // and transient (they migrate down to the released update on a later launch),
  // so this is tracked separately and never counted as a rollback-suspect.
  onNewerPulled: number
  onEmbedded: number
  unknown: number
  suspectCount: number
  suspects: Suspect[]
}

class Service {
  options: UnknownRecord
  app: AppLike

  constructor(options?: UnknownRecord) {
    this.options = options || {}
  }

  setup(app: AppLike) {
    this.app = app
  }

  async get(project: string, params?: { query?: UnknownRecord }) {
    const activeWindowDays = Number(params?.query?.activeWindowDays) || DEFAULT_ACTIVE_WINDOW_DAYS
    const graceHours = Number(params?.query?.graceHours) || DEFAULT_GRACE_HOURS
    const now = moment()
    const activeCutoff = now.clone().subtract(activeWindowDays, 'days')

    // Fetch ALL uploads (not just released) so we can order updates by createdAt
    // and tell "behind the released target" apart from "ahead of it" (running a
    // newer update that an admin later rolled back).
    const allUploads = (await this.app.service('uploads').find({ query: { project } })) as UploadRecord[]
    const createdAtById: Record<string, number> = {}
    for (const u of allUploads) {
      if (u.updateId && u.createdAt) createdAtById[u.updateId] = moment(u.createdAt).valueOf()
    }

    // Released target per (version, releaseChannel). updateId is per-upload (not
    // per-platform), so a single released id covers both ios and android.
    const releasedByKey: Record<string, { updateId?: string; releasedAt?: string | Date; createdAtMs?: number }> = {}
    for (const u of allUploads) {
      if (u.status !== 'released') continue
      releasedByKey[`${u.version}-${u.releaseChannel}`] = {
        updateId: u.updateId,
        releasedAt: u.releasedAt,
        createdAtMs: u.createdAt ? moment(u.createdAt).valueOf() : undefined,
      }
    }

    const clients = (await this.app.service('clients').find({ query: { project } })) as ClientRecord[]
    const buckets: Record<string, AdoptionBucket> = {}

    for (const c of clients) {
      // Active filter — skip dormant/uninstalled clients.
      if (!c.lastSeen || moment(c.lastSeen).isBefore(activeCutoff)) continue

      const bucketKey = `${c.version}-${c.platform}-${c.releaseChannel}`
      const rel = releasedByKey[`${c.version}-${c.releaseChannel}`]
      if (!buckets[bucketKey]) {
        buckets[bucketKey] = {
          version: c.version,
          platform: c.platform,
          releaseChannel: c.releaseChannel,
          releasedUpdateId: rel?.updateId,
          releasedAt: rel?.releasedAt,
          activeDevices: 0,
          onLatest: 0,
          onOlderOTA: 0,
          onNewerPulled: 0,
          onEmbedded: 0,
          unknown: 0,
          suspectCount: 0,
          suspects: [],
        }
      }
      const bucket = buckets[bucketKey]
      bucket.activeDevices++

      const current = c.currentUpdate
      const releasedId = rel?.updateId

      if (!current) {
        bucket.unknown++
        continue
      }
      if (releasedId && current === releasedId) {
        bucket.onLatest++
        continue
      }

      // Ahead of the released target: the device runs an update created AFTER
      // the released one — it adopted something an admin later rolled back. Not
      // a failure; it'll migrate down to the released update on a later launch.
      const currentCreatedAt = createdAtById[current]
      const isAheadOfReleased =
        releasedId != null && rel?.createdAtMs != null && currentCreatedAt != null && currentCreatedAt > rel.createdAtMs
      if (isAheadOfReleased) {
        bucket.onNewerPulled++
        continue
      }

      // Genuinely behind: split embedded (on the build) vs older OTA.
      if (current === c.embeddedUpdate) bucket.onEmbedded++
      else bucket.onOlderOTA++

      // Rollback-suspect: a release exists, the device is BEHIND it (not ahead),
      // and it was last seen AFTER the release had time to download+apply
      // (releasedAt + grace). That rules out the normal apply lag and the
      // post-rollback "ahead" devices, leaving the genuinely stuck ones.
      if (releasedId && rel?.releasedAt) {
        const graceCutoff = moment(rel.releasedAt).add(graceHours, 'hours')
        if (moment(c.lastSeen).isAfter(graceCutoff)) {
          bucket.suspectCount++
          if (bucket.suspects.length < SUSPECT_SAMPLE_CAP) {
            bucket.suspects.push({
              clientId: c._id,
              platform: c.platform,
              currentUpdate: current,
              lastSeen: c.lastSeen,
              updateCount: c.updateCount,
            })
          }
        }
      }
    }

    const result = Object.values(buckets)
      .map((b) => ({
        ...b,
        adoptionRate: b.activeDevices > 0 ? b.onLatest / b.activeDevices : 0,
      }))
      .sort((a, b) => (a.version > b.version ? -1 : a.version < b.version ? 1 : 0))

    return { project, activeWindowDays, graceHours, generatedAt: now.toDate(), buckets: result }
  }
}

export default {
  name: 'adoption',
  createService: (options?: UnknownRecord) => new Service(options),
  hooks: {
    before: {
      all: s.defaultSecurity(),
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: [],
    },
    after: {
      all: [],
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: [],
    },
  },
}

export { Service }
