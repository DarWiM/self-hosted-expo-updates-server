import { useState } from 'react'
import moment from 'moment'
import { Column } from 'primereact/column'
import type { DataTableExpandedRows } from 'primereact/datatable'
import { DataTable } from 'primereact/datatable'

import { Card, Spinner, Text } from '../../Components'
import { useCQuery } from '../../Services'

interface AdoptionSuspect {
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
  onNewerPulled: number
  onEmbedded: number
  unknown: number
  suspectCount: number
  suspects: AdoptionSuspect[]
  adoptionRate: number
}

interface AdoptionReport {
  project: string
  activeWindowDays: number
  graceHours: number
  generatedAt: string
  buckets: AdoptionBucket[]
}

const formatDate = (date?: string | Date | null) => (date ? moment(date).format('YYYY-MM-DD HH:mm:ss') : '—')

const shortId = (id?: string) => (id ? `${id.slice(0, 8)}…` : '—')

// Adoption health colour: green when most active devices are on the latest
// release, amber mid, red when adoption is poor (likely a stuck/failed rollout).
const rateColor = (rate: number) => (rate >= 0.8 ? '#7fdc96' : rate >= 0.5 ? '#e6c34a' : '#e07f7f')

const AdoptionRate = ({ rate }: { rate: number }) => {
  const pct = rate * 100
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 14, color: rateColor(rate) }}>
        {pct.toFixed(1)}%
      </span>
      <div
        style={{ width: '100%', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: rateColor(rate) }} />
      </div>
    </div>
  )
}

const SuspectsTable = ({ bucket }: { bucket: AdoptionBucket }) => (
  <div style={{ padding: '8px 12px' }}>
    <Text value={`Rollback suspects (${bucket.suspectCount})`} style={{ marginBottom: 8, opacity: 0.8 }} />
    <DataTable value={bucket.suspects} emptyMessage="No suspects" style={{ width: '100%' }}>
      <Column
        header="Client"
        body={(s: AdoptionSuspect) => (
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{shortId(s.clientId)}</span>
        )}
      />
      <Column field="platform" header="Platform" style={{ width: 100 }} />
      <Column
        header="Running"
        body={(s: AdoptionSuspect) => (
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{shortId(s.currentUpdate)}</span>
        )}
      />
      <Column field="updateCount" header="Checks" style={{ width: 90 }} />
      <Column
        header="Last Request"
        body={(s: AdoptionSuspect) => <span style={{ fontSize: 12 }}>{formatDate(s.lastSeen)}</span>}
      />
    </DataTable>
  </div>
)

export const AdoptionPanel = ({ project }: { project: string }) => {
  const { data, isSuccess, isFetching } = useCQuery<AdoptionReport>(['adoption', project])
  const [expandedRows, setExpandedRows] = useState<DataTableExpandedRows | AdoptionBucket[]>([])

  if (!isSuccess && isFetching) return <Spinner />
  const buckets = (data?.buckets || []).map((b) => ({
    ...b,
    id: `${b.version}-${b.platform}-${b.releaseChannel}`,
  }))
  if (!buckets.length) return null

  const title = `Update adoption  ·  active window ${data?.activeWindowDays ?? 7}d  ·  grace ${data?.graceHours ?? 24}h`

  return (
    <Card style={{ marginTop: 16, width: '100%' }} title={title}>
      <DataTable
        style={{ width: '100%', marginTop: 8, marginBottom: 8 }}
        value={buckets}
        dataKey="id"
        expandedRows={expandedRows}
        onRowToggle={(e) => setExpandedRows(e.data)}
        rowExpansionTemplate={(row: AdoptionBucket) => <SuspectsTable bucket={row} />}
        emptyMessage="No active clients">
        <Column expander={(row: AdoptionBucket) => row.suspectCount > 0} style={{ width: 48 }} />
        <Column field="version" header="Runtime" sortable style={{ width: 110 }} />
        <Column field="platform" header="Platform" sortable style={{ width: 100 }} />
        <Column field="releaseChannel" header="Channel" sortable style={{ width: 120 }} />
        <Column
          header="Released"
          body={(row: AdoptionBucket) => (
            <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} title={row.releasedUpdateId}>
              {row.releasedUpdateId ? shortId(row.releasedUpdateId) : '— none —'}
            </span>
          )}
        />
        <Column
          field="adoptionRate"
          header="Adoption"
          sortable
          style={{ width: 120 }}
          body={(row: AdoptionBucket) => <AdoptionRate rate={row.adoptionRate} />}
        />
        <Column field="onLatest" header="Latest" sortable style={{ width: 90 }} />
        <Column field="onOlderOTA" header="Older OTA" sortable style={{ width: 100 }} />
        <Column
          field="onNewerPulled"
          header="Pulled"
          sortable
          style={{ width: 90 }}
          body={(row: AdoptionBucket) => (
            <span title="On an update newer than released — adopted then rolled back; migrating down. Not a failure.">
              {row.onNewerPulled || '—'}
            </span>
          )}
        />
        <Column field="onEmbedded" header="Embedded" sortable style={{ width: 100 }} />
        <Column
          field="suspectCount"
          header="Suspects"
          sortable
          style={{ width: 100 }}
          body={(row: AdoptionBucket) => (
            <span
              style={{
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 600,
                color: row.suspectCount > 0 ? '#e07f7f' : 'inherit',
              }}>
              {row.suspectCount || '—'}
            </span>
          )}
        />
        <Column field="activeDevices" header="Active" sortable style={{ width: 90 }} />
      </DataTable>
      <Text
        value="Suspects = active devices not on the latest release after the grace window (possible failed/rolled-back update). Indicative, not a confirmed failure."
        style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}
      />
    </Card>
  )
}
