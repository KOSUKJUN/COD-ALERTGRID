<script setup lang="ts">
/**
 * 근거 이벤트 패널.
 *
 * 그리드/이벤트 상세는 COD-SEARCHGRID 의 <SearchGrid> 를 그대로 사용한다 (코드 복사 없음).
 * → 이벤트 상세(필드 +/− 필터, Payload, PCAP 분석, JSON, 팝업 전환, Payload 창·비교·Diff, 키보드…) 는
 *   @codvill/cod-searchgrid 가 업데이트되면 이 패널에서도 자동으로 같아진다.
 *
 * 대량 근거 이벤트 대응
 *  - 원격 페이징 + 무한 스크롤 + 가상 스크롤 (SearchGrid)
 *  - 필드 요약 / 시간 분포는 groupBy·histogram 집계 요청만 보낸다 (전체 이벤트를 받지 않음)
 *  - 근거 이벤트 안에서 다시 검색 · 그룹핑 · 시간 범위 드래그로 좁히기
 *  - 탭이 처음 열릴 때만 로드 (lazy), 경보를 바꾸면 이전 요청은 abort
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import {
  SearchGrid,
  parseQuery,
  type DataSource,
  type GridColumn,
  type GroupBucket,
  type LogRecord,
  type SearchRequest,
} from '@codvill/cod-searchgrid'
import type { AlertRecord, EvidenceOptions, EvidenceScope, EvidenceSource, HistogramBucket, HistogramFn, OpenInSearchContext } from '../types'
import { fmt, type AlertMessages } from '../messages'
import { joinQuery, stripFieldTokens, timeRangeTokens, toEpoch } from '../utils/alert'
import EvidenceHistogram from './EvidenceHistogram.vue'

const props = withDefaults(
  defineProps<{
    alert: AlertRecord
    source: EvidenceSource
    histogram?: HistogramFn
    options: EvidenceOptions
    messages: AlertMessages
    theme?: 'light' | 'dark'
    /** 경보 발생 시각 (히스토그램 표시선) */
    alertTime?: unknown
    /** 경보 레코드의 근거 이벤트 건수 (보관 건수와 비교해 안내) */
    expectedCount?: number
    contextMinuteOptions?: number[]
    /** 내부 SearchGrid 에 그대로 전달할 props (features, pageSize, payloadField …) */
    gridProps?: Record<string, unknown>
    storageKey?: string
    initialQuery?: string
    openInSearch?: (ctx: OpenInSearchContext) => void
  }>(),
  {
    histogram: undefined,
    theme: 'light',
    alertTime: undefined,
    expectedCount: undefined,
    contextMinuteOptions: () => [5, 15, 60, 240],
    gridProps: () => ({}),
    storageKey: undefined,
    initialQuery: '',
    openInSearch: undefined,
  },
)

const emit = defineEmits<{
  loaded: [total: number]
  error: [e: unknown]
}>()

const LARGE = 10_000
const FACET_TOP = 5

const grid = ref<InstanceType<typeof SearchGrid> | null>(null)
const scope = ref<EvidenceScope>('evidence')
const contextMinutes = ref(props.contextMinuteOptions[1] ?? props.contextMinuteOptions[0] ?? 15)
const activeQuery = ref(props.initialQuery)
const total = ref<number | null>(null)

function readPref(name: string, def: boolean): boolean {
  if (!props.storageKey) return def
  try {
    const v = localStorage.getItem(`${props.storageKey}:${name}`)
    return v == null ? def : v === '1'
  } catch {
    return def
  }
}
function writePref(name: string, v: boolean): void {
  if (!props.storageKey) return
  try {
    localStorage.setItem(`${props.storageKey}:${name}`, v ? '1' : '0')
  } catch {
    /* 저장소 사용 불가 */
  }
}
const showTimeline = ref(readPref('timeline', true))
const showFacets = ref(readPref('facets', true))
watch(showTimeline, (v) => writePref('timeline', v))
watch(showFacets, (v) => writePref('facets', v))

/** SearchGrid 에 넘기는 DataSource — 경보·범위를 붙여 EvidenceSource 로 위임 */
const dataSource: DataSource = (req: SearchRequest) =>
  props.source({ ...req, alert: props.alert, scope: scope.value, contextMinutes: contextMinutes.value })

const columns = computed<GridColumn[]>(() => {
  if (scope.value !== 'context') return props.options.columns
  const marker: GridColumn = {
    field: props.options.markerField,
    label: '근거',
    width: 68,
    align: 'center',
    // SearchGrid 는 새 컬럼을 맨 뒤에 붙이므로, 좌측 고정으로 항상 맨 앞에 보이게 한다
    frozen: true,
    sortable: true,
    groupable: true,
    highlight: false,
    formatter: (v) => (v === true || v === 'true' || v === 1 ? '●' : ''),
    cellClass: (v) => (v === true || v === 'true' || v === 1 ? 'cag-ev-mark' : undefined),
  }
  return [marker, ...props.options.columns.filter((c) => c.field !== props.options.markerField)]
})

/** SearchGrid 가 새 검색을 시작할 때마다 (마운트 직후 포함) 집계도 다시 */
function onSearch(req: SearchRequest): void {
  activeQuery.value = req.query
  reloadAggregates()
}
function onLoaded(_rows: LogRecord[], t: number): void {
  total.value = t
  emit('loaded', t)
}

function setScope(s: EvidenceScope): void {
  if (scope.value === s) return
  scope.value = s
  total.value = null
  grid.value?.refresh()
  reloadAggregates()
}
watch(contextMinutes, () => {
  if (scope.value !== 'context') return
  grid.value?.refresh()
  reloadAggregates()
})

// ------------------------------------------------------------ 시간 분포 / 필드 요약 (집계 요청만)
const tf = computed(() => props.options.timeField)
const baseQuery = computed(() => stripFieldTokens(activeQuery.value, tf.value))
const range = computed(() => {
  const fs = parseQuery(activeQuery.value).filters.filter((f) => f.field === tf.value)
  const ge = fs.find((f) => f.op === '>=' || f.op === '>')
  const lt = fs.find((f) => f.op === '<' || f.op === '<=')
  if (!ge && !lt) return null
  return { start: ge ? toEpoch(ge.value) : -Infinity, end: lt ? toEpoch(lt.value) : Infinity }
})

const buckets = shallowRef<HistogramBucket[]>([])
const histLoading = ref(false)
const facets = shallowRef<Record<string, { groups: GroupBucket[]; total: number }>>({})
const facetLoading = ref(false)
let aggAbort: AbortController | null = null
let aggTimer: ReturnType<typeof setTimeout> | undefined

function reloadAggregates(): void {
  clearTimeout(aggTimer)
  aggTimer = setTimeout(loadAggregates, 120)
}

async function loadAggregates(): Promise<void> {
  aggAbort?.abort()
  const ac = (aggAbort = new AbortController())
  const base = { alert: props.alert, scope: scope.value, contextMinutes: contextMinutes.value, signal: ac.signal }
  const jobs: Promise<unknown>[] = []
  if (showTimeline.value && props.histogram) {
    histLoading.value = true
    jobs.push(
      props
        .histogram({ ...base, query: baseQuery.value, buckets: 60 })
        .then((b) => {
          if (!ac.signal.aborted) buckets.value = b
        })
        .catch((e) => !ac.signal.aborted && emit('error', e))
        .finally(() => !ac.signal.aborted && (histLoading.value = false)),
    )
  }
  if (showFacets.value && props.options.facets.length) {
    facetLoading.value = true
    const q = activeQuery.value
    jobs.push(
      Promise.all(
        props.options.facets.map((field) =>
          props
            .source({ ...base, query: q, offset: 0, limit: FACET_TOP, groupBy: field })
            .then((r) => [field, { groups: (r.groups ?? []).slice(0, FACET_TOP), total: r.total }] as const),
        ),
      )
        .then((list) => {
          if (!ac.signal.aborted) facets.value = Object.fromEntries(list)
        })
        .catch((e) => !ac.signal.aborted && emit('error', e))
        .finally(() => !ac.signal.aborted && (facetLoading.value = false)),
    )
  }
  await Promise.all(jobs)
}

watch(showTimeline, (v) => v && reloadAggregates())
watch(showFacets, (v) => v && reloadAggregates())
onBeforeUnmount(() => {
  aggAbort?.abort()
  clearTimeout(aggTimer)
})

function selectRange(start: number, end: number): void {
  grid.value?.search(joinQuery(baseQuery.value, timeRangeTokens(tf.value, start, end)))
}
function clearRange(): void {
  grid.value?.search(baseQuery.value)
}
function addFilter(field: string, op: '=' | '!=', value: string | null): void {
  if (value === null) grid.value?.search(joinQuery(activeQuery.value, `${field}${op === '=' ? '!=' : '='}*`))
  else grid.value?.addFilter(field, op, value)
}

const markerTime = computed(() => {
  const t = toEpoch(props.alertTime)
  return Number.isFinite(t) ? t : undefined
})

const notice = computed(() => {
  if (total.value == null) return ''
  if (scope.value === 'evidence' && !activeQuery.value && props.expectedCount && props.expectedCount > total.value)
    return fmt(props.messages.truncated, { n: total.value, m: props.expectedCount })
  if (total.value >= LARGE) return fmt(props.messages.evidenceLarge, { n: total.value })
  return ''
})

const gridStorageKey = computed(() => (props.storageKey ? `${props.storageKey}:grid` : undefined))

defineExpose({
  /** 근거 이벤트 그리드 검색어 설정 */
  search: (q: string) => grid.value?.search(q),
  addFilter: (field: string, value: unknown) => grid.value?.addFilter(field, '=', value),
  refresh: () => {
    grid.value?.refresh()
    reloadAggregates()
  },
  /** 내부 COD-SEARCHGRID 인스턴스 (exportData, openPayloadWindow … 사용 가능) */
  grid,
})
</script>

<template>
  <div class="cag-ev">
    <div class="cag-ev__bar">
      <div v-if="contextMinuteOptions.length" class="cag-seg" role="radiogroup">
        <button
          type="button"
          role="radio"
          class="cag-seg__btn"
          :class="{ 'cag-seg__btn--on': scope === 'evidence' }"
          :aria-checked="scope === 'evidence'"
          @click="setScope('evidence')"
        >
          {{ messages.scopeEvidence }}
        </button>
        <button
          type="button"
          role="radio"
          class="cag-seg__btn"
          :class="{ 'cag-seg__btn--on': scope === 'context' }"
          :aria-checked="scope === 'context'"
          :title="messages.scopeContextHint"
          @click="setScope('context')"
        >
          {{ messages.scopeContext }}
        </button>
      </div>
      <select v-if="scope === 'context'" v-model.number="contextMinutes" class="cag-select" :aria-label="messages.scopeContext">
        <option v-for="mn in contextMinuteOptions" :key="mn" :value="mn">{{ fmt(messages.minutes, { n: mn }) }}</option>
      </select>
      <span v-if="total != null" class="cag-ev__count">
        <b>{{ total.toLocaleString() }}</b>건
        <template v-if="expectedCount != null && scope === 'evidence' && activeQuery"> / {{ expectedCount.toLocaleString() }}</template>
      </span>
      <span class="cag-spacer" />
      <button
        v-if="histogram"
        type="button"
        class="cag-chip-btn"
        :class="{ 'cag-chip-btn--on': showTimeline }"
        :aria-pressed="showTimeline"
        @click="showTimeline = !showTimeline"
      >
        ▁▃▅ {{ messages.timeline }}
      </button>
      <button
        v-if="options.facets.length"
        type="button"
        class="cag-chip-btn"
        :class="{ 'cag-chip-btn--on': showFacets }"
        :aria-pressed="showFacets"
        @click="showFacets = !showFacets"
      >
        ☰ {{ messages.facets }}
      </button>
      <button
        v-if="openInSearch"
        type="button"
        class="cag-chip-btn"
        @click="openInSearch({ alert, query: activeQuery, scope, contextMinutes })"
      >
        ↗ {{ messages.openInSearch }}
      </button>
    </div>

    <div v-if="notice" class="cag-ev__notice" role="status">ⓘ {{ notice }}</div>

    <div v-if="histogram && showTimeline" class="cag-ev__timeline">
      <EvidenceHistogram
        :buckets="buckets"
        :marker="markerTime"
        :range="range"
        :loading="histLoading"
        :hint="messages.timelineHint"
        @select="selectRange"
      />
      <button v-if="range" type="button" class="cag-link-btn cag-ev__clear" @click="clearRange">✕ {{ messages.clearRange }}</button>
    </div>

    <div class="cag-ev__body">
      <aside v-if="showFacets && options.facets.length" class="cag-facets" :class="{ 'cag-facets--loading': facetLoading }" :aria-label="messages.facets">
        <div class="cag-facets__hint">{{ messages.facetsHint }}</div>
        <section v-for="f in options.facets" :key="f" class="cag-facet">
          <h4 class="cag-facet__title">{{ options.columns.find((c) => c.field === f)?.label ?? f }}</h4>
          <ul class="cag-facet__list">
            <li v-for="g in facets[f]?.groups ?? []" :key="String(g.value)" class="cag-facet__item">
              <span class="cag-facet__fill" :style="{ width: `${facets[f].total ? (g.count / facets[f].total) * 100 : 0}%` }" />
              <span class="cag-facet__val" :title="g.value ?? '(없음)'">{{ g.value ?? '(없음)' }}</span>
              <span class="cag-facet__cnt">{{ g.count.toLocaleString() }}</span>
              <span class="cag-facet__act">
                <button type="button" class="cag-mini-btn" :title="messages.include" @click="addFilter(f, '=', g.value)">+</button>
                <button type="button" class="cag-mini-btn" :title="messages.exclude" @click="addFilter(f, '!=', g.value)">−</button>
              </span>
            </li>
          </ul>
        </section>
      </aside>

      <div class="cag-ev__grid">
        <SearchGrid
          ref="grid"
          :columns="columns"
          :data-source="dataSource"
          :query="initialQuery"
          :row-key="options.rowKey"
          :theme="theme"
          :storage-key="gridStorageKey"
          :detail-width="380"
          :groupable="true"
          export-file-name="evidence"
          v-bind="gridProps"
          @search="onSearch"
          @loaded="onLoaded"
          @error="emit('error', $event)"
        >
          <template v-for="(_, name) in $slots" #[name]="slotProps">
            <slot :name="name" v-bind="slotProps ?? {}" />
          </template>
          <template v-if="!$slots.empty" #empty>{{ messages.noEvidence }}</template>
        </SearchGrid>
      </div>
    </div>
  </div>
</template>
