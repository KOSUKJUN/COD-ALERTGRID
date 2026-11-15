<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  SearchGrid,
  DEFAULT_MESSAGES as SG_MESSAGES,
  buildFilterToken,
  getValueByPath,
  type ContextMenuContext,
  type MenuItem,
  type DataSource,
  type GridColumn,
  type LogRecord,
  type SearchRequest,
} from '@codvill/cod-searchgrid'
import {
  DEFAULT_FIELD_MAP,
  type AlertDetailTab,
  type AlertFieldMap,
  type AlertRecord,
  type DetailLayout,
  type EntityDef,
  type EvidenceOptions,
  type EvidenceSource,
  type HistogramFn,
  type OpenInSearchContext,
} from '../types'
import { DEFAULT_ALERT_MESSAGES, fmt, type AlertMessages } from '../messages'
import {
  SEVERITIES,
  createLocalSource,
  formatRelative,
  formatShortTime,
  formatSpan,
  countryName,
  flagEmoji,
  formatTime,
  joinQuery,
  localHistogram,
  toEpoch,
} from '../utils/alert'
import AlertDetail from './AlertDetail.vue'
import '../styles/alertgrid.css'

const props = withDefaults(
  defineProps<{
    /** 경보 목록 컬럼 (미지정 시 fieldMap 기반 기본 컬럼) */
    columns?: GridColumn[]
    /** 로컬 경보 데이터 */
    rows?: AlertRecord[]
    /** 원격 경보 소스 (COD-SEARCHGRID DataSource 프로토콜, groupBy 지원 시 심각도 건수 표시) */
    dataSource?: DataSource
    fieldMap?: Partial<AlertFieldMap>
    entities?: EntityDef[]
    /** 근거 이벤트 원격 소스. 미지정 시 alert[fieldMap.evidence] 배열 사용 */
    evidenceSource?: EvidenceSource
    /** 근거 이벤트 시간 분포. 미지정 + 로컬 근거 이벤트면 클라이언트에서 계산 */
    evidenceHistogram?: HistogramFn
    evidenceColumns?: GridColumn[]
    /** 근거 이벤트 필드 요약(Top 5) 대상 */
    evidenceFacets?: string[]
    evidenceTimeField?: string
    evidenceMarkerField?: string
    evidenceRowKey?: string
    /** 전후 문맥 범위 선택지(분) */
    contextMinuteOptions?: number[]
    /** 근거 이벤트 SearchGrid 에 전달할 추가 props */
    evidenceGridProps?: Record<string, unknown>
    /** 경보 목록 SearchGrid 에 전달할 추가 props */
    alertGridProps?: Record<string, unknown>
    /** 근거 이벤트를 전체 검색 화면으로 pivot */
    openInSearch?: (ctx: OpenInSearchContext) => void
    query?: string
    rowKey?: string
    theme?: 'light' | 'dark'
    height?: string
    storageKey?: string
    detailLayout?: DetailLayout
    /** 자동 새로고침 선택지(초, 0 = 끔) */
    refreshOptions?: number[]
    refreshInterval?: number
    /** 행 맨 앞 '상세보기' 버튼 컬럼 */
    detailButton?: boolean
    messages?: Partial<AlertMessages>
  }>(),
  {
    columns: undefined,
    rows: () => [],
    dataSource: undefined,
    fieldMap: () => ({}),
    entities: () => [
      { field: 'src_ip', type: 'ip', label: 'Source IP' },
      { field: 'dest_ip', type: 'ip', label: 'Destination IP' },
      { field: 'host', type: 'host', label: 'Destination Host' },
    ],
    evidenceSource: undefined,
    evidenceHistogram: undefined,
    evidenceColumns: undefined,
    evidenceFacets: () => ['src_ip', 'dest_ip', 'dest_port', 'action'],
    evidenceTimeField: '_time',
    evidenceMarkerField: 'is_evidence',
    evidenceRowKey: 'event_id',
    contextMinuteOptions: () => [5, 15, 60, 240],
    evidenceGridProps: () => ({}),
    alertGridProps: () => ({}),
    openInSearch: undefined,
    query: '',
    rowKey: undefined,
    theme: 'light',
    height: '100%',
    storageKey: undefined,
    detailLayout: 'right',
    refreshOptions: () => [0, 30, 60, 300],
    refreshInterval: 0,
    detailButton: true,
    messages: () => ({}),
  },
)

const emit = defineEmits<{
  'alert-open': [alert: AlertRecord]
  'selection-change': [alerts: AlertRecord[]]
  error: [e: unknown]
}>()

const m = computed<AlertMessages>(() => ({ ...DEFAULT_ALERT_MESSAGES, ...props.messages }))
const fm = computed<AlertFieldMap>(() => ({ ...DEFAULT_FIELD_MAP, ...props.fieldMap }))
const sk = (n: string) => (props.storageKey ? `${props.storageKey}:${n}` : undefined)

// ================================================================ alert list source
const grid = ref<InstanceType<typeof SearchGrid> | null>(null)
const severity = ref<string | null>(null)
const userQuery = ref(props.query)

const severityToken = computed(() => (severity.value ? buildFilterToken(fm.value.severity, '=', severity.value) : ''))
const baseSource = computed<DataSource>(() => props.dataSource ?? createLocalSource(() => props.rows))

/** 심각도 조건을 검색어 뒤에 숨겨서 붙인다 (사용자 검색창은 그대로) */
const alertSource: DataSource = (req: SearchRequest) =>
  baseSource.value({ ...req, query: joinQuery(req.query, severityToken.value) })

// ================================================================ severity counts (groupBy 집계)
const severityCounts = shallowRef<Record<string, number> | null>(null)
let countAbort: AbortController | null = null

async function loadCounts(): Promise<void> {
  countAbort?.abort()
  const ac = (countAbort = new AbortController())
  let out: Record<string, number> | null = null
  try {
    const r = await baseSource.value({ query: userQuery.value, offset: 0, limit: 100, groupBy: fm.value.severity, signal: ac.signal })
    if (r.groups) {
      out = {}
      for (const g of r.groups) out[String(g.value).toLowerCase()] = g.count
    }
  } catch {
    out = null
  }
  if (!ac.signal.aborted) severityCounts.value = out
}

function toggleSeverity(s: string): void {
  severity.value = severity.value === s ? null : s
  grid.value?.refresh()
}
function reload(): void {
  grid.value?.refresh()
  loadCounts()
}
function onSearch(req: SearchRequest): void {
  userQuery.value = req.query
  loadCounts()
}

// 로컬 데이터가 바뀌면 다시 조회
watch(
  () => [props.rows, props.rows.length],
  () => {
    if (!props.dataSource) reload()
  },
)

// ================================================================ loaded rows / navigation
const loadedRows = shallowRef<LogRecord[]>([])
const total = ref<number | null>(null)
function onLoaded(rows: LogRecord[], t: number): void {
  loadedRows.value = rows
  total.value = t
}
function onSelection(rows: LogRecord[]): void {
  emit('selection-change', rows)
}

// ================================================================ detail
const openAlert = shallowRef<AlertRecord | null>(null)
const detailTab = ref<AlertDetailTab>('overview')
const layout = ref<DetailLayout>(props.detailLayout)
const maximized = ref(false)
const mainEl = ref<HTMLElement | null>(null)
const size = ref<{ right: number; bottom: number }>({ right: 0, bottom: 0 })
const idOf = (a: AlertRecord) => String(getValueByPath(a, fm.value.id) ?? '')

{
  try {
    const raw = sk('layout') ? localStorage.getItem(sk('layout')!) : null
    if (raw) {
      const s = JSON.parse(raw) as { layout?: DetailLayout; right?: number; bottom?: number }
      if (s.layout) layout.value = s.layout
      size.value = { right: s.right ?? 0, bottom: s.bottom ?? 0 }
    }
  } catch {
    /* 저장소 사용 불가 */
  }
}
watch(
  [layout, size],
  () => {
    const key = sk('layout')
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify({ layout: layout.value, ...size.value }))
    } catch {
      /* 저장소 사용 불가 */
    }
  },
  { deep: true },
)

function open(alert: AlertRecord, tab: AlertDetailTab = detailTab.value): void {
  const same = openAlert.value && idOf(openAlert.value) === idOf(alert)
  openAlert.value = alert
  detailTab.value = tab
  if (!same) emit('alert-open', alert)
}
/** 행 더블클릭 → 경보 상세 (한 번 클릭은 행 선택만) */
function onRowDblClick(row: LogRecord): void {
  open(row, 'overview')
}

/**
 * 우클릭 메뉴: 맨 위에 '경보 상세보기'.
 * COD-SEARCHGRID 기본 메뉴의 이벤트 상세 항목은 경보 목록에서는 동작하지 않으므로(showDetail=false) 뺀다.
 */
function contextMenu(ctx: ContextMenuContext): MenuItem[] {
  if (!ctx.row) return ctx.defaults
  const row = ctx.row
  const drop = new Set([SG_MESSAGES.viewDetail, SG_MESSAGES.popout])
  const defaults = ctx.defaults.filter((i) => !drop.has(i.label ?? '') && !(i.label ?? '').startsWith(`${SG_MESSAGES.payload} `))
  return [
    { label: `🔎 ${m.value.viewDetail}`, shortcut: 'Double-click', action: () => open(row, 'overview') },
    { label: `📄 ${m.value.viewEvidence}`, action: () => open(row, 'evidence') },
    { separator: true },
    ...defaults,
  ]
}
function closeDetail(): void {
  openAlert.value = null
  maximized.value = false
}

const openIndex = computed(() => (openAlert.value ? loadedRows.value.indexOf(openAlert.value) : -1))
function step(d: number): void {
  const i = openIndex.value + d
  const next = loadedRows.value[i]
  if (!next) return
  open(next)
  grid.value?.scrollToIndex(i)
}

const panelStyle = computed(() => {
  if (maximized.value) return {}
  const el = mainEl.value
  if (layout.value === 'right') {
    const w = size.value.right || Math.round((el?.clientWidth ?? 1200) * 0.58)
    return { width: `${w}px` }
  }
  const h = size.value.bottom || Math.round((el?.clientHeight ?? 700) * 0.6)
  return { height: `${h}px` }
})

function startResize(e: PointerEvent): void {
  const el = mainEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const move = (ev: PointerEvent) => {
    if (layout.value === 'right') {
      const w = Math.round(rect.right - ev.clientX)
      size.value = { ...size.value, right: Math.min(rect.width - 240, Math.max(360, w)) }
    } else {
      const h = Math.round(rect.bottom - ev.clientY)
      size.value = { ...size.value, bottom: Math.min(rect.height - 120, Math.max(220, h)) }
    }
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.userSelect = ''
  }
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  e.preventDefault()
}

// ================================================================ evidence (원격 or 로컬)
const evidenceCache = new WeakMap<object, DataSource>()
const localEvidenceOf = (alert: AlertRecord): LogRecord[] => {
  const v = getValueByPath(alert, fm.value.evidence)
  return Array.isArray(v) ? (v as LogRecord[]) : []
}
const evidenceSourceEff = computed<EvidenceSource>(
  () =>
    props.evidenceSource ??
    ((req) => {
      let ds = evidenceCache.get(req.alert)
      if (!ds) evidenceCache.set(req.alert, (ds = createLocalSource(() => localEvidenceOf(req.alert))))
      return ds(req)
    }),
)
const evidenceHistogramEff = computed<HistogramFn | undefined>(
  () =>
    props.evidenceHistogram ??
    (props.evidenceSource
      ? undefined
      : async (req) => localHistogram(localEvidenceOf(req.alert), props.evidenceTimeField, req.query, req.buckets)),
)
const evidenceGridPropsEff = computed(() => ({ pageSize: 200, ...props.evidenceGridProps }))

const DEFAULT_EVIDENCE_COLUMNS: GridColumn[] = [
  { field: '_time', label: 'Time', width: 170, formatter: (v) => formatTime(v) },
  { field: 'severity', label: 'Severity', width: 90 },
  { field: 'host', label: 'Host', width: 110 },
  { field: 'action', label: 'Action', width: 90 },
  { field: 'src_ip', label: 'Src IP', width: 120 },
  { field: 'dest_ip', label: 'Dest IP', width: 120 },
  { field: 'dest_port', label: 'Port', width: 64, align: 'right' },
  { field: 'message', label: 'Message', width: 520 },
  { field: 'event_id', label: 'Event ID', width: 120, hidden: true },
]
const evidenceOptions = computed<EvidenceOptions>(() => ({
  columns: props.evidenceColumns ?? DEFAULT_EVIDENCE_COLUMNS,
  facets: props.evidenceFacets,
  timeField: props.evidenceTimeField,
  markerField: props.evidenceMarkerField,
  rowKey: props.evidenceRowKey,
}))

// ================================================================ columns
/** 상세보기 버튼 컬럼 (데이터 필드 아님, 좌측 고정) */
const DETAIL_COL = '__alert_detail'
const detailColumn = computed<GridColumn>(() => ({
  field: DETAIL_COL,
  label: m.value.detailColumn,
  width: 92,
  align: 'center',
  frozen: true,
  sortable: false,
  resizable: false,
  groupable: false,
  highlight: false,
  formatter: () => '',
}))
/** 상세에 열려 있는 경보인지 (새로고침으로 객체가 바뀌어도 경보 ID 로 비교) */
function isOpen(row: LogRecord): boolean {
  const a = openAlert.value
  if (!a) return false
  if (a === row) return true
  const id = idOf(a)
  return id !== '' && idOf(row) === id
}

/**
 * 열린 경보 행의 모든 셀에 cag-td--open 을 붙인다 → CSS :has() 로 행 전체 강조.
 * (SearchGrid 렌더 중에 openAlert 를 읽으므로 상세를 바꾸면 목록이 다시 그려진다)
 */
function withOpenClass(c: GridColumn): GridColumn {
  const orig = c.cellClass
  return {
    ...c,
    cellClass: (v, row) => {
      const base = typeof orig === 'function' ? orig(v, row) : orig
      if (!isOpen(row)) return base
      return base ? `${base} cag-td--open` : 'cag-td--open'
    },
  }
}

const alertColumns = computed<GridColumn[]>(() =>
  [...(props.detailButton ? [detailColumn.value] : []), ...baseColumns.value.filter((c) => c.field !== DETAIL_COL)].map(
    withOpenClass,
  ),
)
/**
 * 기본 컬럼 — 이벤트 리스트(한 줄 로그 표)와 구분되는 2줄 카드형.
 * 심각도 · 경보(제목 / 규칙·ID) · Source(IP:Port / 국기·국가) · Destination(IP:Port / 중요 자산) · 발생 시각 · 근거 이벤트 수
 * 개별 필드 컬럼(국가, 포트, 자산명, 호스트 …)은 숨김으로 두어 컬럼 메뉴·그룹핑·정렬에서 쓸 수 있게 한다.
 */
const baseColumns = computed<GridColumn[]>(() => {
  if (props.columns) return props.columns
  const f = fm.value
  return [
    { field: f.severity, label: m.value.severity, width: 118 },
    { field: f.title, label: m.value.alertColumn, width: 380 },
    { field: f.srcIp, label: m.value.source, width: 210 },
    { field: f.destIp, label: m.value.destination, width: 210 },
    { field: f.time, label: m.value.timeColumn, width: 190, formatter: (v) => formatTime(v) },
    { field: f.evidenceCount, label: m.value.evidence, width: 128, align: 'right', groupable: false },
    { field: f.rule, label: m.value.rule, width: 240, hidden: true },
    {
      field: f.srcCountry,
      label: m.value.srcCountryLabel,
      width: 150,
      hidden: true,
      formatter: (v) => countryName(v) || m.value.unknownCountry,
    },
    { field: f.srcPort, label: m.value.srcPortLabel, width: 100, align: 'right', hidden: true },
    { field: f.destPort, label: m.value.destPortLabel, width: 100, align: 'right', hidden: true },
    { field: f.destAsset, label: m.value.destAssetLabel, width: 150, hidden: true },
    { field: f.destHost, label: m.value.destHostLabel, width: 120, hidden: true },
    { field: f.id, label: 'Alert ID', width: 110, hidden: true },
  ]
})

// ---------------------------------------------------------------- 카드형 셀 표시용
const SEV_ICON: Record<string, string> = { critical: '⛔', high: '▲', medium: '◆', low: '▽', info: 'ℹ' }
const val = (row: LogRecord, field: string) => {
  const v = getValueByPath(row, field)
  return v == null || v === '' ? '' : String(v)
}
/** 상대 시각 갱신용 (30초) */
const now = ref(Date.now())
const nowTimer = setInterval(() => (now.value = Date.now()), 30_000)
function durationOf(row: LogRecord): string {
  const a = toEpoch(getValueByPath(row, fm.value.firstSeen))
  const b = toEpoch(getValueByPath(row, fm.value.lastSeen))
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? formatSpan(b - a) : ''
}

// ================================================================ auto refresh
const refreshSec = ref(props.refreshInterval)
let refreshTimer: ReturnType<typeof setInterval> | undefined
watch(
  refreshSec,
  (s) => {
    clearInterval(refreshTimer)
    if (s > 0)
      refreshTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return
        reload()
      }, s * 1000)
  },
  { immediate: true },
)

onMounted(loadCounts)
onBeforeUnmount(() => {
  clearInterval(nowTimer)
  clearInterval(refreshTimer)
  countAbort?.abort()
})

/** 사용자 슬롯 중 경보 목록 SearchGrid 로 넘길 것 (evidence-* 는 근거 이벤트 그리드로) */
const passSlots = (names: string[]) => names.filter((n) => !n.startsWith('evidence-') && n !== 'bar-extra')

const rootStyle = computed(() => ({ height: props.height }))
const severityRows = computed(() => SEVERITIES.map((s) => ({ s, n: severityCounts.value?.[s] })))

defineExpose({
  /** 목록 + 건수 다시 조회 */
  refresh: reload,
  /** 경보 상세 열기 (tab: overview | evidence | json) */
  openAlert: (alert: AlertRecord, tab?: AlertDetailTab) => open(alert, tab),
  closeDetail,
  setSeverity: (s: string | null) => {
    severity.value = s
    grid.value?.refresh()
  },
  search: (q?: string) => grid.value?.search(q),
  /** 경보 목록 COD-SEARCHGRID 인스턴스 */
  grid,
})
</script>

<template>
  <div class="csg cag" :class="[`csg--${theme}`, `cag--${theme}`]" :style="rootStyle">
    <!-- ============================== severity + refresh -->
    <div class="cag-bar">
      <h2 class="cag-bar__title">
        <span class="cag-bar__icon" aria-hidden="true">🚨</span>{{ m.listTitle }}
        <span v-if="total != null" class="cag-bar__count">{{ total.toLocaleString() }}{{ m.countUnit }}</span>
      </h2>
      <div class="cag-sevchips" role="group" :aria-label="m.severity">
        <button
          v-for="{ s, n } in severityRows"
          :key="s"
          type="button"
          class="cag-sevchip"
          :class="[`cag-sevchip--${s}`, { 'cag-sevchip--on': severity === s, 'cag-sevchip--zero': !n }]"
          :aria-pressed="severity === s"
          @click="toggleSeverity(s)"
        >
          {{ s }} <b>{{ n != null ? n.toLocaleString() : '–' }}</b>
        </button>
      </div>
      <span class="cag-spacer" />
      <slot name="bar-extra" />
      <button type="button" class="cag-icon-btn" :title="m.refresh" :aria-label="m.refresh" @click="reload">⟳</button>
      <select v-model.number="refreshSec" class="cag-select cag-select--sm" :aria-label="m.autoRefresh" :title="m.autoRefresh">
        <option v-for="s in refreshOptions" :key="s" :value="s">{{ s ? `⟳ ${fmt(m.seconds, { n: s })}` : `⟳ ${m.off}` }}</option>
      </select>
    </div>

    <!-- ============================== list + detail -->
    <div ref="mainEl" class="cag-main" :class="`cag-main--${layout}`">
      <div class="cag-list cag-list--cards">
        <SearchGrid
          ref="grid"
          :columns="alertColumns"
          :data-source="alertSource"
          :query="query"
          :row-key="rowKey ?? fm.id"
          :row-height="60"
          :theme="theme"
          :show-detail="false"
          :severity-bar="true"
          :severity-field="fm.severity"
          :storage-key="sk('alerts-v4')"
          :features="{ payloadWindows: false, pcapAnalyzer: false }"
          export-file-name="alerts"
          :context-menu="contextMenu"
          v-bind="alertGridProps"
          @search="onSearch"
          @loaded="onLoaded"
          @row-dblclick="onRowDblClick"
          @selection-change="onSelection"
          @error="emit('error', $event)"
        >
          <template v-if="detailButton" #[`cell-${DETAIL_COL}`]="{ row }">
            <button
              type="button"
              class="cag-detailbtn"
              :class="{ 'cag-detailbtn--on': isOpen(row) }"
              :aria-pressed="isOpen(row)"
              :title="m.viewDetailHint"
              :aria-label="m.viewDetailHint"
              @click.stop="open(row, 'overview')"
              @dblclick.stop
            >
              {{ m.viewDetail }}
            </button>
          </template>
          <!-- ───── 카드형 셀 (사용자가 같은 cell-<field> 슬롯을 주면 그쪽 우선) ───── -->
          <template v-if="!$slots[`cell-${fm.severity}`]" #[`cell-${fm.severity}`]="{ value }">
            <span class="cag-sevpill" :class="`cag-sevpill--${String(value ?? '').toLowerCase()}`">
              <span aria-hidden="true">{{ SEV_ICON[String(value ?? '').toLowerCase()] ?? '•' }}</span>
              {{ value ?? '—' }}
            </span>
          </template>
          <template v-if="!$slots[`cell-${fm.title}`]" #[`cell-${fm.title}`]="{ row, value }">
            <div class="cag-cell2">
              <span class="cag-cell2__main cag-cell2__title" :title="String(value ?? '')">{{ value ?? '' }}</span>
              <span class="cag-cell2__sub">
                <template v-if="val(row, fm.rule)">{{ val(row, fm.rule) }} · </template><span class="cag-mono">{{ idOf(row) }}</span>
              </span>
            </div>
          </template>
          <!-- Source / Destination: 같은 구성 — 1줄 IP:Port, 2줄 국기·국가 / 중요 자산 -->
          <template v-if="!$slots[`cell-${fm.srcIp}`]" #[`cell-${fm.srcIp}`]="{ row }">
            <div class="cag-cell2 cag-ep">
              <span class="cag-cell2__main cag-ep__addr"><span :class="{ 'cag-ep__ip': val(row, fm.srcIp) }">{{ val(row, fm.srcIp) || '—' }}</span> <span v-if="val(row, fm.srcPort)" class="cag-port">({{ val(row, fm.srcPort) }})</span></span>
              <span class="cag-cell2__sub cag-ep__meta">
                <span v-if="flagEmoji(val(row, fm.srcCountry))" class="cag-flag" aria-hidden="true">{{ flagEmoji(val(row, fm.srcCountry)) }}</span>
                <span v-else class="cag-flag cag-flag--none" aria-hidden="true">🏳</span>
                {{ countryName(val(row, fm.srcCountry)) || m.unknownCountry }}
              </span>
            </div>
          </template>
          <template v-if="!$slots[`cell-${fm.destIp}`]" #[`cell-${fm.destIp}`]="{ row }">
            <div class="cag-cell2 cag-ep">
              <span class="cag-cell2__main cag-ep__addr"><span :class="{ 'cag-ep__ip': val(row, fm.destIp) }">{{ val(row, fm.destIp) || '—' }}</span> <span v-if="val(row, fm.destPort)" class="cag-port">({{ val(row, fm.destPort) }})</span></span>
              <span class="cag-cell2__sub cag-ep__meta">
                <span class="cag-asset__icon" aria-hidden="true">◈</span>
                <span :class="{ 'cag-muted': !val(row, fm.destAsset) && !val(row, fm.destHost) }">{{
                  val(row, fm.destAsset) || val(row, fm.destHost) || m.unknownAsset
                }}</span>
              </span>
            </div>
          </template>
          <template v-if="!$slots[`cell-${fm.time}`]" #[`cell-${fm.time}`]="{ row, value }">
            <div class="cag-cell2" :title="formatTime(value)">
              <span class="cag-cell2__main cag-cell2__ago">{{ formatRelative(value, now, m) }}</span>
              <span class="cag-cell2__sub">
                {{ formatShortTime(value) }}<template v-if="durationOf(row)"> · {{ fmt(m.lasted, { d: durationOf(row) }) }}</template>
              </span>
            </div>
          </template>
          <template v-if="!$slots[`cell-${fm.evidenceCount}`]" #[`cell-${fm.evidenceCount}`]="{ row, value }">
            <button type="button" class="cag-evbtn cag-evcount" :title="m.viewEvidence" @click.stop="open(row, 'evidence')" @dblclick.stop>
              <span><b>{{ value != null ? Number(value).toLocaleString() : '—' }}</b><small>{{ m.countUnit }}</small></span>
              <span class="cag-evcount__link">{{ m.evidence }} ›</span>
            </button>
          </template>

          <template v-for="name in passSlots(Object.keys($slots))" #[name]="slotProps" :key="name">
            <slot :name="name" v-bind="slotProps ?? {}" />
          </template>
          <template v-if="!$slots.empty" #empty>{{ m.empty }}</template>
        </SearchGrid>
      </div>

      <template v-if="openAlert">
        <div
          v-if="!maximized"
          class="cag-resizer"
          :class="`cag-resizer--${layout}`"
          role="separator"
          :aria-orientation="layout === 'right' ? 'vertical' : 'horizontal'"
          @pointerdown="startResize"
        />
        <div class="cag-panel" :class="{ 'cag-panel--max': maximized }" :style="panelStyle">
          <AlertDetail
            :key="idOf(openAlert)"
            v-model:tab="detailTab"
            :alert="openAlert"
            :field-map="fm"
            :entities="entities"
            :messages="m"
            :theme="theme"
            :layout="layout"
            :maximized="maximized"
            :has-prev="openIndex > 0"
            :has-next="openIndex >= 0 && openIndex < loadedRows.length - 1"
            :evidence-source="evidenceSourceEff"
            :evidence-histogram="evidenceHistogramEff"
            :evidence-options="evidenceOptions"
            :evidence-grid-props="evidenceGridPropsEff"
            :context-minute-options="evidenceSource ? contextMinuteOptions : []"
            :storage-key="storageKey"
            :open-in-search="openInSearch"
            @close="closeDetail"
            @toggle-layout="layout = layout === 'right' ? 'bottom' : 'right'"
            @toggle-max="maximized = !maximized"
            @prev="step(-1)"
            @next="step(1)"
            @filter-alerts="(f, v) => grid?.addFilter(f, '=', v)"
            @error="emit('error', $event)"
          >
            <template v-for="name in Object.keys($slots).filter((n) => n.startsWith('evidence-'))" #[name]="slotProps" :key="name">
              <slot :name="name" v-bind="slotProps ?? {}" />
            </template>
          </AlertDetail>
        </div>
      </template>
    </div>
  </div>
</template>
