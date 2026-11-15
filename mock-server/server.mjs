// 테스트용 Mock 경보 API (의존성 없음, Node >= 22.18 type stripping)
//
//   GET   /api/alerts?q=&offset=0&limit=200&sort=_time&order=desc[&groupBy=severity]
//   GET   /api/alerts/:id/evidence?q=&offset=&limit=&sort=&order=&groupBy=&scope=evidence|context&context=15
//   GET   /api/alerts/:id/evidence/histogram?q=&scope=&context=&buckets=60
//
// 쿼리 해석은 COD-SEARCHGRID 의 query 유틸을 그대로 사용한다 (프런트와 같은 문법).
// 환경 변수: PORT(3002), ALERTS(2000), LATENCY_MS(150)
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { generateAlerts, generateContext, generateEvidence } from './generate.ts'

const sg = existsSync(new URL('../node_modules/@codvill/cod-searchgrid/package.json', import.meta.url))
  ? await import('@codvill/cod-searchgrid')
  : await import('../.searchgrid/src/utils/query.ts')
const { compareValues, filterRecords, getValueByPath, groupCounts } = sg

const PORT = Number(process.env.PORT ?? 3002)
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 150)
const alerts = generateAlerts(Number(process.env.ALERTS ?? 2000))
const byId = new Map(alerts.map((a) => [a.alert_id, a]))
console.log(`[mock-alert-api] ${alerts.length} alerts`)

// 경보별 근거 이벤트 LRU (수십만 건 경보는 처음 요청 시 생성)
const evCache = new Map()
function evidenceOf(a) {
  let e = evCache.get(a.alert_id)
  if (!e) {
    const t0 = performance.now()
    e = { evidence: generateEvidence(a), context: null }
    console.log(`[mock-alert-api] evidence ${a.alert_id}: ${e.evidence.length} events (${Math.round(performance.now() - t0)}ms)`)
    evCache.set(a.alert_id, e)
    if (evCache.size > 6) evCache.delete(evCache.keys().next().value)
  }
  return e
}
function scopedRows(a, scope, minutes) {
  const e = evidenceOf(a)
  if (scope !== 'context') return e.evidence
  e.context ??= generateContext(a, 240)
  const from = new Date(Date.parse(a.first_seen) - minutes * 60_000).toISOString()
  const to = new Date(Date.parse(a.last_seen) + minutes * 60_000).toISOString()
  const ctx = e.context.filter((r) => r._time >= from && r._time <= to)
  return e.evidence.concat(ctx)
}

const qCache = new Map()
function query(key, rows, q, sortField, order) {
  const k = `${key}\u0000${q}\u0000${sortField}\u0000${order}`
  const hit = qCache.get(k)
  if (hit && hit.src === rows) return hit.rows
  let out = filterRecords(rows, q)
  if (sortField) {
    const dir = order === 'asc' ? 1 : -1
    out = out.sort((x, y) => dir * compareValues(getValueByPath(x, sortField), getValueByPath(y, sortField)))
  }
  qCache.set(k, { src: rows, rows: out })
  if (qCache.size > 40) qCache.delete(qCache.keys().next().value)
  return out
}

function send(res, status, body) {
  setTimeout(() => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(body))
  }, LATENCY_MS)
}

/** 공통 검색 응답 (SearchGrid DataSource 프로토콜) */
function searchResponse(key, rows, p, t0) {
  const q = p.get('q') ?? ''
  const offset = Math.max(0, Number(p.get('offset') ?? 0) || 0)
  const groupBy = p.get('groupBy') ?? ''
  const limit = Math.min(groupBy ? 5000 : 1000, Math.max(1, Number(p.get('limit') ?? 200) || 200))
  const sort = p.get('sort') ?? ''
  const order = p.get('order') === 'asc' ? 'asc' : 'desc'
  if (groupBy) {
    const hit = query(key, rows, q, '', order)
    const groups = groupCounts(hit, groupBy, sort ? { field: sort, order } : null).slice(offset, offset + limit)
    return { rows: [], groups, total: hit.length, took: Math.round(performance.now() - t0) }
  }
  const hit = query(key, rows, q, sort, order)
  return { rows: hit.slice(offset, offset + limit), total: hit.length, took: Math.round(performance.now() - t0) }
}

const PUBLIC = (a) => {
  const { _scenario, _seed, _user, ...rest } = a
  return rest
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const p = url.searchParams
  const t0 = performance.now()
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' })
    return res.end()
  }
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, alerts: alerts.length })

    if (url.pathname === '/api/alerts' && req.method === 'GET') {
      const out = searchResponse('alerts', alerts, p, t0)
      return send(res, 200, { ...out, rows: out.rows.map(PUBLIC) })
    }

    const m = /^\/api\/alerts\/([^/]+)(\/evidence(\/histogram)?)?$/.exec(url.pathname)
    if (m) {
      const a = byId.get(decodeURIComponent(m[1]))
      if (!a) return send(res, 404, { error: 'alert not found' })
      const scope = p.get('scope') === 'context' ? 'context' : 'evidence'
      const minutes = Math.min(240, Math.max(1, Number(p.get('context') ?? 15) || 15))
      const rows = scopedRows(a, scope, minutes)
      const key = `${a.alert_id}:${scope}:${minutes}`
      if (m[3]) {
        const hit = query(key, rows, p.get('q') ?? '', '', 'desc')
        const n = Math.min(200, Math.max(4, Number(p.get('buckets') ?? 60) || 60))
        let lo = Infinity
        let hi = -Infinity
        for (const r of hit) {
          const t = Date.parse(r._time)
          if (t < lo) lo = t
          if (t > hi) hi = t
        }
        if (!hit.length) return send(res, 200, { buckets: [] })
        const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400].map((s) => s * 1000)
        const raw = Math.max(1000, (hi - lo || 1000) / n)
        const step = NICE.find((s) => s >= raw) ?? Math.ceil(raw / 86400000) * 86400000
        const start = Math.floor(lo / step) * step
        const len = Math.floor((hi - start) / step) + 1
        const buckets = Array.from({ length: len }, (_, i) => ({ start: start + i * step, end: start + (i + 1) * step, count: 0 }))
        for (const r of hit) buckets[Math.floor((Date.parse(r._time) - start) / step)].count++
        return send(res, 200, { buckets, took: Math.round(performance.now() - t0) })
      }
      if (m[2] === '/evidence') return send(res, 200, searchResponse(key, rows, p, t0))
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    send(res, 400, { error: String(e?.message ?? e) })
  }
})

server.listen(PORT, '0.0.0.0', () => console.log(`[mock-alert-api] listening on http://0.0.0.0:${PORT}`))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)))
