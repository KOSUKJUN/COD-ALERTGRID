import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { SearchGrid } from '@codvill/cod-searchgrid'
import { AlertGrid, type EvidenceRequest, type EvidenceSource } from '../src'
import { createLocalSource } from '../src/utils/alert'

const evidence = (id: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    _time: new Date(Date.UTC(2026, 10, 15, 0, 0, i)).toISOString(),
    event_id: `${id}-E${i}`,
    host: 'web-01',
    src_ip: i % 2 ? '1.1.1.1' : '2.2.2.2',
    action: i % 4 ? 'failure' : 'success',
    message: `event ${i}`,
    payload: `GET /?q=${i} HTTP/1.1`,
  }))

const makeAlerts = () => [
  { alert_id: 'A1', _time: '2026-11-15T00:10:00Z', title: 'SSH brute force', severity: 'high', host: 'web-01', src_ip: '1.1.1.1', src_port: 51515, src_country: 'RU', dest_ip: '10.0.1.11', dest_port: 22, dest_asset: '대외 웹서버', evidence_count: 40, evidence: evidence('A1', 40) },
  { alert_id: 'A2', _time: '2026-11-15T00:09:00Z', title: 'Port scan', severity: 'critical', host: 'db-01', dest_ip: '10.0.3.31', evidence_count: 3, evidence: evidence('A2', 3) },
  { alert_id: 'A3', _time: '2026-11-15T00:08:00Z', title: 'Old one', severity: 'low', host: 'db-01', evidence_count: 1, evidence: evidence('A3', 1) },
]

const mounted: VueWrapper[] = []
afterEach(() => mounted.splice(0).forEach((w) => w.unmount()))
async function mountGrid(props: Record<string, unknown> = {}) {
  const w = mount(AlertGrid, { props: { rows: makeAlerts(), ...props }, attachTo: document.body })
  mounted.push(w)
  await flushPromises()
  await flushPromises()
  return w
}
const alertGrid = (w: VueWrapper) => w.findAllComponents(SearchGrid)[0]
const rowTexts = (w: VueWrapper) =>
  alertGrid(w)
    .findAll('.csg-tr')
    .map((r) => r.text())
    .filter(Boolean)

describe('AlertGrid', () => {
  it('모든 경보를 보여주고 상태/담당자/활동 UI 는 없다', async () => {
    const w = await mountGrid()
    expect(rowTexts(w)).toHaveLength(3)
    expect(w.find('.cag-stabs').exists()).toBe(false)
    const headers = alertGrid(w).findAll('.csg-th').map((t) => t.text())
    expect(headers.join(' ')).not.toMatch(/상태|담당자/)
  })

  it('심각도 칩: 건수 표시 + 클릭 시 필터', async () => {
    const w = await mountGrid()
    expect(w.find('.cag-sevchip--critical').text()).toContain('1')
    await w.find('.cag-sevchip--critical').trigger('click')
    await flushPromises()
    const rows = rowTexts(w)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('Port scan')
    await w.find('.cag-sevchip--critical').trigger('click')
    await flushPromises()
    expect(rowTexts(w)).toHaveLength(3)
  })

  it('행 클릭 → 경보 상세(개요/근거 이벤트/JSON), 근거 이벤트에서 COD-SEARCHGRID 이벤트 상세가 열린다', async () => {
    const w = await mountGrid()
    await alertGrid(w).findAll('.csg-tr')[0].trigger('dblclick')
    expect(w.find('.cag-detail').exists()).toBe(true)
    expect(w.find('.cag-detail__title').text()).toBe('SSH brute force')
    expect(w.findAll('.cag-tabs__btn').map((b) => b.text().replace(/[\d,]+$/, ''))).toEqual(['개요', '근거 이벤트', 'JSON'])

    await w.findAll('.cag-tabs__btn').find((b) => b.text().startsWith('근거 이벤트'))!.trigger('click')
    await flushPromises()
    await flushPromises()
    const ev = w.findAllComponents(SearchGrid)[1]
    expect(ev.exists()).toBe(true)
    expect(ev.find('.csg-status__count').text()).toContain('40')

    // 근거 이벤트 행 클릭 → upstream EventDetail (필드/Payload/JSON 탭)
    await ev.findAll('.csg-tr')[0].trigger('click')
    const detail = ev.find('.csg-detail')
    expect(detail.exists()).toBe(true)
    expect(detail.findAll('.csg-tabs__btn').map((b) => b.text())).toEqual(expect.arrayContaining(['필드', 'Payload', 'JSON']))
  })

  it('필드 요약(Top N)은 groupBy 집계로, + 클릭 시 근거 이벤트 검색에 추가', async () => {
    const calls: EvidenceRequest[] = []
    const inner = createLocalSource(() => evidence('A1', 40))
    const source: EvidenceSource = (req) => {
      calls.push(req)
      return inner(req)
    }
    const w = await mountGrid({ evidenceSource: source, evidenceFacets: ['src_ip', 'action'] })
    await alertGrid(w).findAll('.csg-tr')[0].trigger('dblclick')
    await w.findAll('.cag-tabs__btn')[1].trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 200))
    await flushPromises()
    expect(calls.every((c) => c.alert.alert_id === 'A1' && c.scope === 'evidence')).toBe(true)
    expect(calls.filter((c) => c.groupBy).map((c) => c.groupBy)).toEqual(expect.arrayContaining(['src_ip', 'action']))
    // 패싯 제목은 컬럼 label 을 사용한다
    const facet = w.findAll('.cag-facet').find((f) => f.find('.cag-facet__title').text() === 'Action')!
    expect(facet.text()).toContain('failure')
    await facet.findAll('.cag-facet__item')[0].find('.cag-mini-btn').trigger('click')
    await flushPromises()
    const ev = w.findAllComponents(SearchGrid)[1]
    expect((ev.find('input').element as HTMLInputElement).value).toBe('action=failure')
    expect(ev.find('.csg-status__count').text()).toContain('30')
  })

  it('한 번 클릭은 행 선택만, 더블클릭하면 경보 상세가 열린다', async () => {
    const w = await mountGrid()
    const row = alertGrid(w).findAll('.csg-tr')[1]
    await row.trigger('click')
    expect(w.find('.cag-detail').exists()).toBe(false)
    await row.trigger('dblclick')
    expect(w.find('.cag-detail__title').text()).toBe('Port scan')
    expect(w.find('.cag-tabs__btn--on').text()).toBe('개요')
    expect(w.emitted('alert-open')?.[0][0]).toMatchObject({ alert_id: 'A2' })
  })

  it('행 맨 앞 상세보기 버튼으로 경보 상세를 연다', async () => {
    const w = await mountGrid()
    const btns = alertGrid(w).findAll('.cag-detailbtn')
    expect(btns).toHaveLength(3)
    expect(btns[0].text()).toBe('상세보기')
    await btns[2].trigger('click')
    expect(w.find('.cag-detail__title').text()).toBe('Old one')
    expect(alertGrid(w).findAll('.cag-detailbtn')[2].classes()).toContain('cag-detailbtn--on')
  })

  it('상세에 열린 경보 행이 선택(강조) 표시되고, 이동/닫기를 따라간다', async () => {
    const w = await mountGrid()
    const openRows = () =>
      alertGrid(w)
        .findAll('.csg-tr')
        .filter((r) => r.find('.cag-td--open').exists())
        .map((r) => r.text())
    expect(openRows()).toEqual([])

    await alertGrid(w).findAll('.csg-tr')[0].trigger('dblclick')
    expect(openRows()).toHaveLength(1)
    expect(openRows()[0]).toContain('SSH brute force')
    // 열린 행의 모든 데이터 셀에 표시 (행 전체 강조)
    const row0 = alertGrid(w).findAll('.csg-tr')[0]
    expect(row0.findAll('.csg-td:not(.csg-td--lead)').every((c) => c.classes('cag-td--open'))).toBe(true)
    expect(row0.find('.cag-detailbtn').attributes('aria-pressed')).toBe('true')

    // 다른 경보 열기 → 강조 이동
    await alertGrid(w).findAll('.cag-detailbtn')[2].trigger('click')
    expect(openRows()).toHaveLength(1)
    expect(openRows()[0]).toContain('Old one')

    // ↑ 이전 경보
    await w.find('.cag-detail__head .cag-icon-btn[aria-label="이전 경보"]').trigger('click')
    expect(openRows()[0]).toContain('Port scan')

    // 닫으면 강조 해제
    await w.find('.cag-detail__head .cag-icon-btn[aria-label="닫기"]').trigger('click')
    expect(openRows()).toEqual([])
  })

  it('새로고침으로 행 객체가 바뀌어도 같은 경보 ID 면 계속 강조', async () => {
    const w = await mountGrid()
    await alertGrid(w).findAll('.csg-tr')[1].trigger('dblclick')
    await w.setProps({ rows: makeAlerts() }) // 같은 데이터, 새 객체
    await flushPromises()
    await flushPromises()
    const open = alertGrid(w)
      .findAll('.csg-tr')
      .filter((r) => r.find('.cag-td--open').exists())
    expect(open).toHaveLength(1)
    expect(open[0].text()).toContain('Port scan')
  })

  it('카드형 2줄 행: 심각도 배지 · 제목/ID · 대상 · 상대 시각 · 근거 건수', async () => {
    const w = await mountGrid()
    const g = alertGrid(w)
    expect(w.find('.cag-list--cards').exists()).toBe(true)
    expect(g.props('rowHeight')).toBe(60)
    const first = g.findAll('.csg-tr')[0]
    expect(first.find('.cag-sevpill--high').text()).toContain('high')
    expect(first.find('.cag-cell2__title').text()).toBe('SSH brute force')
    expect(first.find('.cag-cell2__sub').text()).toContain('A1')
    const headers = g.findAll('.csg-th').map((t) => t.text())
    expect(headers).toEqual(expect.arrayContaining(['Source', 'Destination']))
    expect(headers.join(' ')).not.toMatch(/User|공격 국가|중요 자산/)
    // Source / Destination: 1줄 IP:Port, 2줄 국기·국가 / 중요 자산 (같은 구성)
    const [src, dst] = first.findAll('.cag-ep')
    expect(src.find('.cag-ep__addr').text()).toBe('1.1.1.1 (51515)')
    expect(src.find('.cag-port').text()).toBe('(51515)') // 포트는 별도 강조 요소
    expect(src.find('.cag-flag').text()).toBe('🇷🇺')
    expect(src.find('.cag-ep__meta').text()).toContain('러시아')
    expect(dst.find('.cag-ep__addr').text()).toBe('10.0.1.11 (22)')
    expect(dst.find('.cag-ep__meta').text()).toContain('대외 웹서버')
    // 국가/포트/자산명이 없으면: IP 만, 국가 미상, 자산명 대신 호스트
    const [src2, dst2] = g.findAll('.csg-tr')[1].findAll('.cag-ep')
    expect(src2.find('.cag-ep__addr').text()).toBe('—')
    expect(src2.find('.cag-ep__meta').text()).toContain('국가 미상')
    expect(dst2.find('.cag-ep__addr').text()).toBe('10.0.3.31')
    expect(dst2.find('.cag-ep__meta').text()).toContain('db-01')
    expect(first.find('.cag-cell2__ago').text()).toMatch(/전|방금/)
    expect(first.find('.cag-evcount b').text()).toBe('40')
    expect(w.find('.cag-bar__count').text()).toBe('3건')
  })

  it('개요에 Source → Destination 표시 (목록과 같은 구성), 기본 엔티티에 user 없음', async () => {
    const w = await mountGrid()
    await alertGrid(w).findAll('.csg-tr')[0].trigger('dblclick')
    const src = w.find('.cag-flow__box--src')
    const dst = w.find('.cag-flow__box--dst')
    expect(src.find('.cag-flow__label').text()).toBe('Source')
    expect(src.find('.cag-flow__main').text()).toBe('1.1.1.1 (51515)')
    expect(src.find('.cag-flow__sub').text()).toContain('🇷🇺')
    expect(src.find('.cag-flow__sub').text()).toContain('러시아')
    expect(dst.find('.cag-flow__label').text()).toBe('Destination')
    expect(dst.find('.cag-flow__main').text()).toBe('10.0.1.11 (22)')
    expect(dst.find('.cag-flow__sub').text()).toContain('대외 웹서버')
    const labels = w.findAll('.cag-entity__label').map((e) => e.text())
    expect(labels).toEqual(['Source IP', 'Destination IP', 'Destination Host'])
  })

  it('detailButton=false 면 버튼 컬럼이 없다', async () => {
    const w = await mountGrid({ detailButton: false })
    expect(alertGrid(w).find('.cag-detailbtn').exists()).toBe(false)
  })

  it('목록의 근거 이벤트 건수 버튼은 바로 근거 이벤트 탭을 연다', async () => {
    const w = await mountGrid()
    await alertGrid(w).find('.cag-evbtn').trigger('click')
    await flushPromises()
    expect(w.find('.cag-tabs__btn--on').text()).toContain('근거 이벤트')
  })

  it('엔티티 → 근거 이벤트 pivot', async () => {
    const w = await mountGrid()
    await alertGrid(w).findAll('.csg-tr')[0].trigger('dblclick')
    const ent = w.findAll('.cag-entity').find((e) => e.text().includes('1.1.1.1'))!
    await ent.findAll('.cag-mini-btn')[0].trigger('click')
    await flushPromises()
    await flushPromises()
    const ev = w.findAllComponents(SearchGrid)[1]
    expect((ev.find('input').element as HTMLInputElement).value).toBe('src_ip=1.1.1.1')
    expect(ev.find('.csg-status__count').text()).toContain('20')
  })
})
