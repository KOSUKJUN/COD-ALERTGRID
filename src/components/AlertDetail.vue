<script setup lang="ts">
import { computed, ref, useSlots, watch } from 'vue'
import { getValueByPath } from '@codvill/cod-searchgrid'
import type {
  AlertDetailTab,
  AlertFieldMap,
  AlertRecord,
  DetailLayout,
  EntityDef,
  EvidenceOptions,
  EvidenceSource,
  HistogramFn,
  OpenInSearchContext,
} from '../types'
import { fmt, type AlertMessages } from '../messages'
import { asList, countryName, flagEmoji, formatSpan, formatTime, toEpoch } from '../utils/alert'
import EvidencePanel from './EvidencePanel.vue'

const props = withDefaults(
  defineProps<{
    alert: AlertRecord
    fieldMap: AlertFieldMap
    entities?: EntityDef[]
    messages: AlertMessages
    theme?: 'light' | 'dark'
    tab?: AlertDetailTab
    layout?: DetailLayout
    maximized?: boolean
    hasPrev?: boolean
    hasNext?: boolean
    evidenceSource: EvidenceSource
    evidenceHistogram?: HistogramFn
    evidenceOptions: EvidenceOptions
    evidenceGridProps?: Record<string, unknown>
    contextMinuteOptions?: number[]
    storageKey?: string
    openInSearch?: (ctx: OpenInSearchContext) => void
  }>(),
  {
    entities: () => [],
    theme: 'light',
    tab: 'overview',
    layout: 'right',
    maximized: false,
    hasPrev: false,
    hasNext: false,
    evidenceHistogram: undefined,
    evidenceGridProps: () => ({}),
    contextMinuteOptions: undefined,
    storageKey: undefined,
    openInSearch: undefined,
  },
)

const emit = defineEmits<{
  close: []
  'update:tab': [tab: AlertDetailTab]
  'toggle-layout': []
  'toggle-max': []
  prev: []
  next: []
  'filter-alerts': [field: string, value: unknown]
  error: [e: unknown]
}>()

const f = computed(() => props.fieldMap)
const get = (field: string) => getValueByPath(props.alert, field)
const str = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

const title = computed(() => str(get(f.value.title)) || str(get(f.value.rule)) || str(get(f.value.id)))
const severity = computed(() => str(get(f.value.severity)).toLowerCase())
const evidenceCount = computed(() => {
  const v = Number(get(f.value.evidenceCount))
  if (Number.isFinite(v)) return v
  const arr = get(f.value.evidence)
  return Array.isArray(arr) ? arr.length : undefined
})
const firstSeen = computed(() => get(f.value.firstSeen) ?? get(f.value.time))
const lastSeen = computed(() => get(f.value.lastSeen) ?? get(f.value.time))
const duration = computed(() => formatSpan(toEpoch(lastSeen.value) - toEpoch(firstSeen.value)))
const srcCountry = computed(() => str(get(f.value.srcCountry)))
const srcIp = computed(() => str(get(f.value.srcIp)))
const srcPort = computed(() => str(get(f.value.srcPort)))
const destIp = computed(() => str(get(f.value.destIp)))
const destPort = computed(() => str(get(f.value.destPort)))
const destHost = computed(() => str(get(f.value.destHost)))
const destName = computed(() => str(get(f.value.destAsset)) || destHost.value)

const entityList = computed(() =>
  props.entities.flatMap((e) => asList(get(e.field)).map((value) => ({ ...e, value, label: e.label ?? e.field }))),
)

const ENTITY_ICON: Record<string, string> = { host: '🖥', user: '👤', ip: '🌐', process: '⚙', file: '📄', url: '🔗', hash: '#' }

/** 개요의 '경보 필드' 표 — 이미 위에 보여준 필드/근거 이벤트 배열은 제외 */
const shown = computed(() => new Set([f.value.title, f.value.description, f.value.evidence]))
const fieldRows = computed(() => {
  const out: [string, unknown][] = []
  const walk = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const p = prefix ? `${prefix}.${k}` : k
      if (shown.value.has(p)) continue
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v as Record<string, unknown>, p)
      else out.push([p, v])
    }
  }
  walk(props.alert as Record<string, unknown>, '')
  return out
})

// ------------------------------------------------------------ tabs
const tabs = computed(() => [
  { id: 'overview' as const, label: props.messages.overview, badge: undefined as number | undefined },
  { id: 'evidence' as const, label: props.messages.evidence, badge: evidenceCount.value },
  { id: 'json' as const, label: props.messages.json, badge: undefined as number | undefined },
])
const evidenceVisited = ref(props.tab === 'evidence')
watch(
  () => props.tab,
  (t) => {
    if (t === 'evidence') evidenceVisited.value = true
  },
)
const evidence = ref<InstanceType<typeof EvidencePanel> | null>(null)
const evidenceQuery = ref('')

/** 엔티티 → 근거 이벤트에서 같은 값만 (pivot) */
function pivotToEvidence(field: string, value: string): void {
  const token = `${field}=${/[\s"]/.test(value) ? `"${value.replace(/"/g, '')}"` : value}`
  if (evidence.value) evidence.value.search(token)
  else evidenceQuery.value = token
  evidenceVisited.value = true
  emit('update:tab', 'evidence')
}

const json = computed(() =>
  JSON.stringify(props.alert, (k, v) => (k === f.value.evidence && Array.isArray(v) ? `[${v.length} events]` : v), 2),
)
const evStorageKey = computed(() => (props.storageKey ? `${props.storageKey}:evidence` : undefined))

/** AlertGrid 의 `evidence-<slot>` 슬롯 → 근거 이벤트 SearchGrid 의 `<slot>` (예: evidence-cell-host → cell-host) */
const slots = useSlots()
const evidenceSlots = computed(() => Object.keys(slots).filter((n) => n.startsWith('evidence-')))

defineExpose({ pivotToEvidence, evidence })
</script>

<template>
  <section class="cag-detail" :aria-label="title">
    <header class="cag-detail__head">
      <span class="cag-sev" :class="`cag-sev--${severity}`">{{ severity || '—' }}</span>
      <h3 class="cag-detail__title" :title="title">{{ title }}</h3>
      <span class="cag-detail__id">{{ str(get(fieldMap.id)) }}</span>
      <span class="cag-spacer" />
      <button type="button" class="cag-icon-btn" :disabled="!hasPrev" :title="messages.prev" :aria-label="messages.prev" @click="emit('prev')">↑</button>
      <button type="button" class="cag-icon-btn" :disabled="!hasNext" :title="messages.next" :aria-label="messages.next" @click="emit('next')">↓</button>
      <button
        type="button"
        class="cag-icon-btn"
        :title="layout === 'right' ? messages.layoutBottom : messages.layoutRight"
        :aria-label="layout === 'right' ? messages.layoutBottom : messages.layoutRight"
        @click="emit('toggle-layout')"
      >
        {{ layout === 'right' ? '⬓' : '◨' }}
      </button>
      <button
        type="button"
        class="cag-icon-btn"
        :title="maximized ? messages.restore : messages.maximize"
        :aria-label="maximized ? messages.restore : messages.maximize"
        @click="emit('toggle-max')"
      >
        {{ maximized ? '⤡' : '⤢' }}
      </button>
      <button type="button" class="cag-icon-btn" :title="messages.close" :aria-label="messages.close" @click="emit('close')">✕</button>
    </header>

    <nav class="cag-tabs" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        role="tab"
        class="cag-tabs__btn"
        :class="{ 'cag-tabs__btn--on': tab === t.id }"
        :aria-selected="tab === t.id"
        @click="emit('update:tab', t.id)"
      >
        {{ t.label }}<span v-if="t.badge != null" class="cag-tabs__badge">{{ t.badge.toLocaleString() }}</span>
      </button>
    </nav>

    <!-- ===================================================== 개요 -->
    <div v-if="tab === 'overview'" class="cag-detail__scroll cag-ov">
      <!-- Source → Destination (목록과 같은 구성: IP:Port / 국기·국가, 중요 자산) -->
      <div class="cag-flow">
        <div class="cag-flow__box cag-flow__box--src">
          <div class="cag-flow__label">{{ messages.source }}</div>
          <div class="cag-flow__main cag-mono"><span :class="{ 'cag-flow__ip': srcIp }">{{ srcIp || '—' }}</span> <span v-if="srcPort" class="cag-port">({{ srcPort }})</span></div>
          <div class="cag-flow__sub">
            <span v-if="flagEmoji(srcCountry)" class="cag-flag" aria-hidden="true">{{ flagEmoji(srcCountry) }}</span>
            <span v-else class="cag-flag cag-flag--none" aria-hidden="true">🏳</span>
            {{ countryName(srcCountry) || messages.unknownCountry }}
          </div>
        </div>
        <div class="cag-flow__arrow" aria-hidden="true">➜</div>
        <div class="cag-flow__box cag-flow__box--dst">
          <div class="cag-flow__label">{{ messages.destination }}</div>
          <div class="cag-flow__main cag-mono"><span :class="{ 'cag-flow__ip': destIp }">{{ destIp || '—' }}</span> <span v-if="destPort" class="cag-port">({{ destPort }})</span></div>
          <div class="cag-flow__sub">
            <span class="cag-asset__icon" aria-hidden="true">◈</span>
            <span :class="{ 'cag-muted': !destName }">{{ destName || messages.unknownAsset }}</span>
            <template v-if="destHost && destHost !== destName"> · {{ destHost }}</template>
          </div>
        </div>
      </div>

      <dl class="cag-kpis">
        <div class="cag-kpi">
          <dt>{{ messages.evidence }}</dt>
          <dd>
            <button type="button" class="cag-link-btn cag-kpi__big" @click="emit('update:tab', 'evidence')">
              {{ evidenceCount != null ? evidenceCount.toLocaleString() : '—' }}
            </button>
          </dd>
        </div>
        <div class="cag-kpi">
          <dt>{{ messages.firstSeen }}</dt>
          <dd>{{ formatTime(firstSeen) }}</dd>
        </div>
        <div class="cag-kpi">
          <dt>{{ messages.lastSeen }}</dt>
          <dd>
            {{ formatTime(lastSeen) }} <small v-if="duration" class="cag-muted">({{ duration }})</small>
          </dd>
        </div>
        <div v-if="get(fieldMap.rule) != null" class="cag-kpi cag-kpi--wide">
          <dt>{{ messages.rule }}</dt>
          <dd>{{ str(get(fieldMap.rule)) }}</dd>
        </div>
      </dl>

      <section v-if="get(fieldMap.description)" class="cag-ov__sec">
        <h4>{{ messages.description }}</h4>
        <p class="cag-ov__desc">{{ str(get(fieldMap.description)) }}</p>
      </section>

      <section v-if="entityList.length" class="cag-ov__sec">
        <h4>{{ messages.entities }}</h4>
        <ul class="cag-entities">
          <li v-for="e in entityList" :key="`${e.field}=${e.value}`" class="cag-entity">
            <span class="cag-entity__icon" aria-hidden="true">{{ ENTITY_ICON[e.type] ?? '•' }}</span>
            <span class="cag-entity__label">{{ e.label }}</span>
            <code class="cag-entity__val" :title="e.value">{{ e.value }}</code>
            <button type="button" class="cag-mini-btn" :title="messages.filterEvidence" @click="pivotToEvidence(e.evidenceField ?? e.field, e.value)">
              📄
            </button>
            <button type="button" class="cag-mini-btn" :title="messages.filterAlerts" @click="emit('filter-alerts', e.field, e.value)">🔍</button>
          </li>
        </ul>
      </section>

      <button type="button" class="cag-btn cag-btn--primary cag-ov__cta" @click="emit('update:tab', 'evidence')">
        📄 {{ evidenceCount != null ? fmt(messages.evidenceCount, { n: evidenceCount }) : messages.viewEvidence }} →
      </button>

      <section class="cag-ov__sec">
        <h4>{{ messages.fields }}</h4>
        <table class="cag-kv">
          <tbody>
            <tr v-for="[k, v] in fieldRows" :key="k">
              <th scope="row">{{ k }}</th>
              <td>{{ str(v) }}</td>
              <td class="cag-kv__act">
                <button v-if="v != null && typeof v !== 'object'" type="button" class="cag-mini-btn" :title="messages.filterAlerts" @click="emit('filter-alerts', k, v)">
                  +
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- ===================================================== 근거 이벤트 (처음 열 때만 로드, 이후 유지) -->
    <div v-if="evidenceVisited" v-show="tab === 'evidence'" class="cag-detail__ev">
      <EvidencePanel
        ref="evidence"
        :alert="alert"
        :source="evidenceSource"
        :histogram="evidenceHistogram"
        :options="evidenceOptions"
        :messages="messages"
        :theme="theme"
        :alert-time="get(fieldMap.time)"
        :expected-count="evidenceCount"
        :context-minute-options="contextMinuteOptions"
        :grid-props="evidenceGridProps"
        :storage-key="evStorageKey"
        :initial-query="evidenceQuery"
        :open-in-search="openInSearch"
        @error="emit('error', $event)"
      >
        <template v-for="name in evidenceSlots" #[name.slice(9)]="slotProps" :key="name">
          <slot :name="name" v-bind="slotProps ?? {}" :alert="alert" />
        </template>
      </EvidencePanel>
    </div>

    <pre v-if="tab === 'json'" class="cag-detail__json">{{ json }}</pre>
  </section>
</template>
