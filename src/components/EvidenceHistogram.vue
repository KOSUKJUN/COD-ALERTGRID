<script setup lang="ts">
import { computed, ref } from 'vue'
import type { HistogramBucket } from '../types'
import { formatSpan, formatTime } from '../utils/alert'

const props = defineProps<{
  buckets: HistogramBucket[]
  /** 경보 발생 시각 (세로선) */
  marker?: number
  /** 현재 선택된 범위 */
  range?: { start: number; end: number } | null
  loading?: boolean
  hint?: string
}>()

const emit = defineEmits<{ select: [start: number, end: number] }>()

const H = 56
const svg = ref<SVGSVGElement | null>(null)
const hover = ref<number>(-1)
const drag = ref<{ a: number; b: number } | null>(null)

const max = computed(() => props.buckets.reduce((m, b) => Math.max(m, b.count), 0))
const total = computed(() => props.buckets.reduce((s, b) => s + b.count, 0))
const n = computed(() => props.buckets.length)
const lo = computed(() => props.buckets[0]?.start ?? 0)
const hi = computed(() => props.buckets[n.value - 1]?.end ?? 1)
const step = computed(() => (n.value ? props.buckets[0].end - props.buckets[0].start : 0))
const pct = (t: number) => ((t - lo.value) / Math.max(1, hi.value - lo.value)) * 100

function idxAt(e: PointerEvent): number {
  const r = svg.value!.getBoundingClientRect()
  const x = Math.min(Math.max(e.clientX - r.left, 0), r.width - 0.01)
  return Math.floor((x / r.width) * n.value)
}
function down(e: PointerEvent): void {
  if (!n.value) return
  const i = idxAt(e)
  drag.value = { a: i, b: i }
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
}
function move(e: PointerEvent): void {
  if (!n.value) return
  const i = idxAt(e)
  hover.value = i
  if (drag.value) drag.value = { ...drag.value, b: i }
}
function up(): void {
  const d = drag.value
  drag.value = null
  if (!d) return
  const a = Math.min(d.a, d.b)
  const b = Math.max(d.a, d.b)
  emit('select', props.buckets[a].start, props.buckets[b].end)
}

const sel = computed(() => {
  if (drag.value) {
    const a = Math.min(drag.value.a, drag.value.b)
    const b = Math.max(drag.value.a, drag.value.b)
    return { left: (a / n.value) * 100, width: ((b - a + 1) / n.value) * 100 }
  }
  if (props.range && n.value) {
    const l = Math.max(0, pct(props.range.start))
    const r = Math.min(100, pct(props.range.end))
    return r > l ? { left: l, width: r - l } : null
  }
  return null
})
const tip = computed(() => (hover.value >= 0 && !drag.value ? props.buckets[hover.value] : null))
</script>

<template>
  <div class="cag-hist" :class="{ 'cag-hist--loading': loading }">
    <div class="cag-hist__axis">
      <span>{{ n ? formatTime(lo) : '' }}</span>
      <span class="cag-hist__meta">
        <template v-if="tip">{{ formatTime(tip.start) }} · <b>{{ tip.count.toLocaleString() }}</b>건</template>
        <template v-else-if="n">{{ total.toLocaleString() }}건 · 구간 {{ formatSpan(step) }}</template>
      </span>
      <span>{{ n ? formatTime(hi) : '' }}</span>
    </div>
    <div class="cag-hist__plot" :title="hint">
      <svg
        ref="svg"
        class="cag-hist__svg"
        :viewBox="`0 0 ${Math.max(1, n)} ${H}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="hint"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointerleave="hover = -1"
      >
        <rect
          v-for="(b, i) in buckets"
          :key="b.start"
          class="cag-hist__bar"
          :class="{ 'cag-hist__bar--hover': i === hover }"
          :x="i + 0.08"
          :width="0.84"
          :y="max ? H - Math.max(b.count ? 1.5 : 0, (b.count / max) * H) : H"
          :height="max ? Math.max(b.count ? 1.5 : 0, (b.count / max) * H) : 0"
        />
      </svg>
      <div v-if="sel" class="cag-hist__sel" :style="{ left: `${sel.left}%`, width: `${sel.width}%` }" />
      <div
        v-if="marker != null && n && marker >= lo && marker <= hi"
        class="cag-hist__marker"
        :style="{ left: `${pct(marker)}%` }"
        title="경보 발생"
      />
    </div>
  </div>
</template>
