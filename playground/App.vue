<script setup lang="ts">
import { markRaw, ref, shallowRef } from 'vue'
import type { DataSource, SearchRequest } from '@codvill/cod-searchgrid'
// playground 는 배포 패키지와 같은 진입점(src/index.ts)을 사용한다
import {
  AlertGrid,
  type AlertRecord,
  type EvidenceRequest,
  type EvidenceSource,
  type HistogramFn,
  type OpenInSearchContext,
} from '../src'
import { generateAlerts, generateEvidence } from '../mock-server/generate'

type Mode = 'remote' | 'local'
const mode = ref<Mode>('remote')
const theme = ref<'light' | 'dark'>(window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
const log = ref<string[]>([])
const say = (s: string) => (log.value = [`${new Date().toLocaleTimeString()} ${s}`, ...log.value].slice(0, 6))

// ------------------------------------------------------------ 원격 모드 (mock-server, /api 프록시)
function params(req: SearchRequest): URLSearchParams {
  const p = new URLSearchParams({ q: req.query, offset: String(req.offset), limit: String(req.limit) })
  if (req.groupBy) p.set('groupBy', req.groupBy)
  if (req.sort) {
    p.set('sort', req.sort.field)
    p.set('order', req.sort.order)
  }
  return p
}
async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  return body as T
}

const alertSource: DataSource = (req) => getJson(`/api/alerts?${params(req)}`, { signal: req.signal })

const evidenceSource: EvidenceSource = (req: EvidenceRequest) => {
  const p = params(req)
  p.set('scope', req.scope)
  p.set('context', String(req.contextMinutes))
  return getJson(`/api/alerts/${encodeURIComponent(String(req.alert.alert_id))}/evidence?${p}`, { signal: req.signal })
}

const evidenceHistogram: HistogramFn = async (req) => {
  const p = new URLSearchParams({ q: req.query, scope: req.scope, context: String(req.contextMinutes), buckets: String(req.buckets) })
  const r = await getJson<{ buckets: { start: number; end: number; count: number }[] }>(
    `/api/alerts/${encodeURIComponent(String(req.alert.alert_id))}/evidence/histogram?${p}`,
    { signal: req.signal },
  )
  return r.buckets
}

// ------------------------------------------------------------ 로컬 모드 (근거 이벤트를 경보에 배열로 포함)
const localAlerts = shallowRef<AlertRecord[]>([])
function loadLocal(): void {
  const list = generateAlerts(300, 7).map((a, i) => {
    // 첫 경보는 2만 건으로 줄여 브라우저 메모리에서도 가볍게
    const b = i === 0 ? { ...a, evidence_count: 20000, evidence_stored: 20000 } : a
    const evidence = markRaw(generateEvidence(b))
    // mock 내부 필드(_scenario, _seed, _user)는 화면에 보이지 않게 제거
    const { _scenario, _seed, _user, ...pub } = b
    void [_scenario, _seed, _user]
    return { ...pub, evidence }
  })
  localAlerts.value = list
}
function setMode(m: Mode): void {
  if (m === 'local' && !localAlerts.value.length) loadLocal()
  mode.value = m
}

function openInSearch(ctx: OpenInSearchContext): void {
  // 실제 앱에서는 router.push({ name: 'search', query: { q: ... } }) 등으로 COD-SEARCHGRID 검색 화면으로 이동
  say(`openInSearch alert=${String(ctx.alert.alert_id)} scope=${ctx.scope} q="${ctx.query}"`)
}
</script>

<template>
  <div class="pg" :class="`pg--${theme}`">
    <header class="pg__head">
      <strong>COD-ALERTGRID</strong>
      <span class="pg__muted">경보 + 근거 이벤트 (이벤트 상세는 COD-SEARCHGRID 그대로)</span>
      <span class="pg__spacer" />
      <label><input type="radio" :checked="mode === 'remote'" @change="setMode('remote')" /> 원격 (mock-api :3002)</label>
      <label><input type="radio" :checked="mode === 'local'" @change="setMode('local')" /> 로컬 배열</label>
      <button type="button" @click="theme = theme === 'light' ? 'dark' : 'light'">{{ theme === 'light' ? '🌙' : '☀️' }}</button>
    </header>
    <main class="pg__main">
      <AlertGrid
        v-if="mode === 'remote'"
        key="remote"
        :data-source="alertSource"
        :evidence-source="evidenceSource"
        :evidence-histogram="evidenceHistogram"
        :theme="theme"
        :open-in-search="openInSearch"
        :alert-grid-props="{ defaultSort: { field: '_time', order: 'desc' } }"
        storage-key="pg-alerts-remote"
        @alert-open="(a) => say(`open ${String(a.alert_id)}`)"
        @error="(e) => say(`error ${e instanceof Error ? e.message : String(e)}`)"
      />
      <AlertGrid
        v-else
        key="local"
        :rows="localAlerts"
        :theme="theme"
        storage-key="pg-alerts-local"
        @alert-open="(a) => say(`open ${String(a.alert_id)}`)"
      />
    </main>
    <footer class="pg__log">
      <span v-for="(l, i) in log" :key="i">{{ l }}</span>
      <span v-if="!log.length" class="pg__muted">
        팁: 근거 이벤트 탭 → 행 클릭 시 COD-SEARCHGRID 이벤트 상세 · 히스토그램 드래그로 시간 범위 좁히기
      </span>
    </footer>
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
.pg {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
  gap: 8px;
  background: #f4f6f9;
  color: #1f2328;
  font: 13px ui-sans-serif, system-ui, 'Segoe UI', 'Malgun Gothic', sans-serif;
}
.pg--dark {
  background: #0a0e13;
  color: #d6dde5;
}
.pg__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.pg__spacer {
  flex: 1;
}
.pg__muted {
  opacity: 0.65;
}
.pg__main {
  flex: 1;
  min-height: 0;
}
.pg__log {
  display: flex;
  gap: 16px;
  overflow: hidden;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  white-space: nowrap;
}
</style>
