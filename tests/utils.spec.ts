import { describe, expect, it } from 'vitest'
import { filterRecords } from '@codvill/cod-searchgrid'
import {
  bucketize,
  countryName,
  createLocalSource,
  flagEmoji,
  formatEndpoint,
  joinQuery,
  localHistogram,
  stripFieldTokens,
  timeRangeTokens,
} from '../src'

describe('flagEmoji / formatEndpoint', () => {
  it('국가 코드 → 국기 이모지', () => {
    expect(flagEmoji('kr')).toBe('🇰🇷')
    expect(flagEmoji('US')).toBe('🇺🇸')
    expect(flagEmoji('대한민국')).toBe('')
    expect(flagEmoji(undefined)).toBe('')
  })
  it('IP (Port), 포트 없으면 IP 만', () => {
    expect(formatEndpoint('1.2.3.4', 443)).toBe('1.2.3.4 (443)')
    expect(formatEndpoint('2001:db8::1', '22')).toBe('2001:db8::1 (22)')
    expect(formatEndpoint('1.2.3.4', null)).toBe('1.2.3.4')
    expect(formatEndpoint('', '')).toBe('')
  })
})

describe('countryName', () => {
  it('국가 코드 → 한글 국가명, 이미 이름이면 그대로', () => {
    expect(countryName('CN')).toBe('중국')
    expect(countryName('ru')).toBe('러시아')
    expect(countryName('대한민국')).toBe('대한민국')
    expect(countryName(null)).toBe('')
  })
})

const rows = Array.from({ length: 1000 }, (_, i) => ({
  id: i,
  _time: new Date(Date.UTC(2026, 10, 15, 0, 0, i)).toISOString(),
  host: i % 3 === 0 ? 'web-01' : 'db-01',
}))

describe('time range tokens', () => {
  it('ISO 범위 토큰이 COD-SEARCHGRID 쿼리 파서로 동작한다', () => {
    const start = Date.UTC(2026, 10, 15, 0, 1, 0)
    const end = Date.UTC(2026, 10, 15, 0, 2, 0)
    const q = timeRangeTokens('_time', start, end)
    expect(filterRecords(rows, q)).toHaveLength(60)
  })

  it('stripFieldTokens 는 해당 필드의 범위 토큰만 지운다', () => {
    const q = joinQuery('host=web-01', timeRangeTokens('_time', 0, 1000), 'NOT error')
    expect(stripFieldTokens(q, '_time')).toBe('host=web-01 NOT error')
  })
})

describe('histogram', () => {
  it('구간 합계 = 이벤트 수, 구간 폭은 nice step', () => {
    const b = bucketize(rows.map((r) => Date.parse(r._time)), 20)
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(1000)
    expect(b[0].end - b[0].start).toBe(60_000)
  })
  it('localHistogram 은 검색어를 적용한다', () => {
    const b = localHistogram(rows, '_time', 'host=web-01')
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(334)
  })
})

describe('createLocalSource', () => {
  it('페이징 + 정렬 + groupBy 집계 (DataSource 프로토콜)', async () => {
    const ds = createLocalSource(() => rows)
    const p1 = await ds({ query: 'host=web-01', offset: 0, limit: 10, sort: { field: 'id', order: 'desc' } })
    expect(p1.total).toBe(334)
    expect(p1.rows[0].id).toBe(999)
    const p2 = await ds({ query: 'host=web-01', offset: 10, limit: 10, sort: { field: 'id', order: 'desc' } })
    expect(p2.rows[0].id).toBe(969)
    const g = await ds({ query: '', offset: 0, limit: 5, groupBy: 'host' })
    expect(g.groups).toEqual([
      { value: 'db-01', count: 666 },
      { value: 'web-01', count: 334 },
    ])
  })
})
