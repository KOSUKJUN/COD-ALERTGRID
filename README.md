# COD-ALERTGRID

SIEM **경보(Alert) 그리드** Vue 3 컴포넌트. [COD-SEARCHGRID](https://github.com/KOSUKJUN/COD-SEARCHGRID) 위에서 동작하며,
경보 목록 · 경보 상세 · **근거 이벤트(경보를 발생시킨 이벤트)** 조회를 제공합니다.

> **근거 이벤트 상세보기는 COD-SEARCHGRID 의 것을 그대로 씁니다.** 코드를 복사하지 않고
> `@codvill/cod-searchgrid` 의 `<SearchGrid>` 를 내장하기 때문에, COD-SEARCHGRID 가 업데이트되면
> 이벤트 상세(필드 +/− 필터, Payload, PCAP 분석, JSON, 팝업 전환, Payload 창·비교·Diff, 키보드 …)도 그대로 따라갑니다.
> ([업데이트 방법](#cod-searchgrid-업데이트-따라가기))

## 기능

벤치마킹: Splunk ES Incident Review(Contributing events drill-down, earliest/latest offset), Microsoft Sentinel Incident(Evidence · Entities · Timeline), Elastic Security Alerts(상세 flyout, Investigate in Timeline).

**경보 목록** — 이벤트 리스트(한 줄 로그 표)와 구분되는 **카드형 2줄 행**
- 심각도 칩 + 건수 (클릭 시 필터)
- COD-SEARCHGRID 검색 그대로: SPL 스타일 쿼리, 자동완성, 그룹핑, 정렬, 컬럼 관리, 내보내기, 무한 스크롤
- **경보 상세 열기: 행 더블클릭 · 행 맨 앞 `상세보기` 버튼 · 우클릭 메뉴** (한 번 클릭은 행 선택만)
- 행 구성: 심각도 배지 · 경보(제목 / 탐지 규칙·ID) · **Source**(`1.1.1.1 (8080)` / 국기·국가명) · **Destination**(`10.0.1.11 (443)` / 중요 자산명), 포트는 색으로 강조 — 두 컬럼 같은 구성 · 발생 시각(“12분 전” / 시각·지속 시간) · **근거 이벤트 건수(클릭 시 바로 근거 이벤트 탭)**
- critical/high 행 배경 강조, 짙은 헤더 + 경보 색 강조선, 상단 “🚨 경보 목록 n건”
- 기본 컬럼을 바꾸려면 `columns`, 셀 모양만 바꾸려면 `cell-<field>` 슬롯 (규칙·Source 국가/Port·Destination Port/자산/호스트·ID 개별 컬럼은 숨김 상태로 컬럼 메뉴에 있음)
- 국기: Windows 는 국기 이모지를 그리지 못해 Twemoji 국기 폰트(78KB)를 `style.css` 에 내장 — CDN·인터넷 불필요, 국가 필드는 2글자 코드(KR, CN, RU …)
- 자동 새로고침(30s/60s/5m, 탭이 숨겨지면 멈춤)

**경보 상세** (오른쪽/아래 배치 전환, 크기 조절, 최대화, ↑↓ 이전/다음 경보)
- 개요: 근거 이벤트 수 · 최초/최근 발생(지속 시간) · 탐지 규칙 · 설명 · **Source → Destination**(목록과 같은 구성) · **엔티티**(Source IP / Destination IP / Destination Host → 근거 이벤트에서 보기 / 경보 검색) · 전체 필드
- 근거 이벤트
- JSON

**근거 이벤트 (대량 대응)**
- 서버 페이징 + 무한 스크롤 + 가상 스크롤 — 수십만 건도 필요한 만큼만 로드 (데모: 250,000건 / 500,000건 경보)
- 범위 전환: **근거 이벤트만** ↔ **전후 문맥 ±N분** (주변 이벤트까지, 근거 이벤트는 ● 표시)
- **시간 분포 히스토그램**: 경보 발생 시각 표시, 드래그로 시간 범위 좁히기 (집계 요청만 전송)
- **필드 요약(Top 5)**: 현재 조건의 근거 이벤트 *전체* 기준 상위 값 (groupBy 집계), +/− 로 포함/제외
- 근거 이벤트 안에서 재검색 · 그룹핑 · 정렬 · CSV/JSON 내보내기 (COD-SEARCHGRID 기능)
- 보관 건수 < 원본 건수면 안내 ("원본 500,000건 중 120,000건만 저장")
- 탭을 처음 열 때만 로드(lazy), 경보 전환 시 이전 요청 abort
- '검색 화면에서 열기' 로 전체 검색 화면으로 pivot

## 설치 / 사용

```bash
# 사내 레지스트리 (.npmrc: @codvill:registry=http://192.168.0.102:20000/repository/codvill-npm/)
npm install @codvill/cod-alertgrid @codvill/cod-searchgrid
```

`@codvill/cod-searchgrid` 는 **peer dependency** 입니다. 사용하는 앱이 설치한 버전을 AlertGrid 가 그대로 씁니다.

```ts
// main.ts
import '@codvill/cod-searchgrid/style.css'
import '@codvill/cod-alertgrid/style.css'
```

```vue
<script setup lang="ts">
import { AlertGrid, type EvidenceSource, type HistogramFn } from '@codvill/cod-alertgrid'
import type { DataSource } from '@codvill/cod-searchgrid'

// 경보 목록: COD-SEARCHGRID DataSource 와 같은 프로토콜 (groupBy 지원 시 심각도 건수 표시)
const alertSource: DataSource = (req) => api.get('/alerts', req)

// 근거 이벤트: DataSource 프로토콜 + alert / scope / contextMinutes
const evidenceSource: EvidenceSource = ({ alert, scope, contextMinutes, ...req }) =>
  api.get(`/alerts/${alert.alert_id}/evidence`, { ...req, scope, context: contextMinutes })

// (선택) 시간 분포
const evidenceHistogram: HistogramFn = ({ alert, query, scope, contextMinutes, buckets }) =>
  api.get(`/alerts/${alert.alert_id}/evidence/histogram`, { q: query, scope, context: contextMinutes, buckets })
</script>

<template>
  <div style="height: 800px">
    <AlertGrid
      :data-source="alertSource"
      :evidence-source="evidenceSource"
      :evidence-histogram="evidenceHistogram"
      storage-key="alerts"
    />
  </div>
</template>
```

로컬 데이터만 있는 경우 `:rows="alerts"` 로 넘기고, 각 경보의 `evidence` 필드(배열)에 근거 이벤트를 넣으면
검색·필드 요약·히스토그램을 클라이언트에서 계산합니다. 대량 배열은 `markRaw()` 로 감싸 반응형 변환 비용을 없애세요.

### 서버 API 계약

| 요청 | 응답 |
| --- | --- |
| 경보 목록 `{ query, offset, limit, sort }` | `{ rows, total }` |
| 경보 집계 `{ query, groupBy: 'severity', limit }` | `{ rows: [], groups: [{ value, count }], total }` |
| 근거 이벤트 `{ alert, scope, contextMinutes, query, offset, limit, sort }` | `{ rows, total }` |
| 근거 이벤트 집계(필드 요약·그룹핑) `{ …, groupBy }` | `{ rows: [], groups, total }` |
| 히스토그램 `{ alert, query, scope, contextMinutes, buckets }` | `[{ start, end, count }]` (epoch ms) |

`query` 문법은 COD-SEARCHGRID 와 같습니다 (`field=value`, `field!=v`, `>= <`, `NOT`, `"phrase"`, 와일드카드).
심각도 칩은 `severity=critical` 처럼, 시간 범위는 `_time>=ISO _time<ISO` 처럼 query 에 붙어서 전달됩니다.
백엔드가 Node 라면 `filterRecords`, `groupCounts` 를 `@codvill/cod-searchgrid` 에서 가져와 그대로 쓸 수 있습니다 (`mock-server/server.mjs` 참고).

### Props (주요)

| Prop | 기본값 | 설명 |
| --- | --- | --- |
| `rows` / `dataSource` | – | 경보 데이터 (로컬 / 원격) |
| `fieldMap` | `alert_id, _time, title, severity, rule_name, description, evidence_count, evidence, first_seen, last_seen, src_ip, src_port, src_country, dest_ip, dest_port, dest_asset, host` | 필드명 매핑 |
| `entities` | src_ip, dest_ip, host | 개요의 엔티티 (`evidenceField` 로 근거 이벤트 필드 매핑) |
| `evidenceSource`, `evidenceHistogram` | – | 근거 이벤트 원격 소스 / 시간 분포 |
| `evidenceColumns`, `evidenceFacets` | 기본 컬럼, `src_ip dest_ip dest_port action` | 근거 이벤트 컬럼 / 필드 요약 대상 |
| `evidenceTimeField`, `evidenceMarkerField`, `evidenceRowKey` | `_time`, `is_evidence`, `event_id` | |
| `contextMinuteOptions` | `[5, 15, 60, 240]` | 전후 문맥 범위 |
| `evidenceGridProps`, `alertGridProps` | – | 내부 `<SearchGrid>` 에 그대로 전달 (`features`, `pageSize`, `payloadField`, `defaultSort` …) |
| `openInSearch` | – | 지정 시 '검색 화면에서 열기' 버튼 |
| `detailLayout` | `right` | `right` \| `bottom` |
| `refreshOptions`, `refreshInterval` | `[0,30,60,300]`, `0` | 자동 새로고침(초) |
| `detailButton` | `true` | 행 맨 앞 `상세보기` 버튼 컬럼 |
| `theme`, `height`, `storageKey`, `messages` | | 테마 / 높이 / 레이아웃·컬럼 저장 키 / 문구 |

**Events**: `alert-open`, `selection-change`, `error`

**Slots**: `cell-<field>`, `toolbar`, `status`, `empty`, `selection-actions` (경보 목록 SearchGrid 로 전달),
`evidence-<slot>` (근거 이벤트 SearchGrid 로 전달, 예: `evidence-cell-host`, `evidence-selection-actions`), `bar-extra` (상단 바)

**Exposed**: `refresh()`, `openAlert(alert, tab?)`, `closeDetail()`, `setSeverity(s)`, `search(q)`, `grid` (경보 목록 SearchGrid 인스턴스)

`AlertDetail`, `EvidencePanel`, `EvidenceHistogram` 와 유틸(`createLocalSource`, `localHistogram`, `timeRangeTokens` …) 도 export 됩니다.

테마는 COD-SEARCHGRID 의 CSS 변수(`--csg-*`)를 그대로 사용합니다.

## COD-SEARCHGRID 업데이트 따라가기

AlertGrid 소스는 `@codvill/cod-searchgrid` 를 **패키지 이름으로만** import 하고, 빌드 시 번들에서 제외(external)합니다.

| 상황 | 하는 일 |
| --- | --- |
| **운영(사용하는 앱)** | 앱에서 `npm update @codvill/cod-searchgrid` — AlertGrid 재배포 없이 근거 이벤트 상세가 새 버전으로 바뀝니다. |
| 이 저장소 개발 (사내망) | `npm i -D @codvill/cod-searchgrid` 후 `npm update @codvill/cod-searchgrid` |
| 이 저장소 개발 (사내망 밖) | `npm run searchgrid:sync` — GitHub main 최신 소스를 `.searchgrid/` 로 받음 (`-- --ref v0.1.3` 로 고정 가능) |
| 두 저장소 동시 개발 | `SEARCHGRID_SOURCE=../COD-SEARCHGRID npm run dev` — 로컬 체크아웃을 바로 사용(HMR) |

해석 순서는 `searchgrid.resolve.ts`: `node_modules` 패키지 → `.searchgrid/` 소스. `npm run searchgrid:which` 로 현재 어떤 버전이 쓰이는지 확인합니다.
`peerDependencies` 는 `>=0.1.2` 입니다. COD-SEARCHGRID 가 사용하는 공개 API(`SearchGrid` props `dataSource/columns/query/showDetail/storageKey…`,
이벤트 `search/loaded/row-click`, 노출 메서드 `search/refresh/addFilter/scrollToIndex`, 쿼리 유틸)가 바뀌는 메이저 업데이트일 때만 AlertGrid 수정이 필요합니다.
`npm test` 에 "근거 이벤트 행 클릭 → COD-SEARCHGRID 이벤트 상세" 테스트가 있어 업데이트 후 깨지면 바로 알 수 있습니다.

## 개발

```bash
npm install
npm run searchgrid:sync   # (패키지를 설치할 수 없는 경우만)
npm run mock              # 터미널 1: mock 경보 API (:3002, 경보 2,000건 / 근거 이벤트 경보별 생성)
npm run dev               # 터미널 2: playground (:5174)
```

| 명령 | 설명 |
| --- | --- |
| `npm test` | Vitest |
| `npm run typecheck` | vue-tsc |
| `npm run build` | `dist/` (ESM, UMD, d.ts, style.css) — cod-searchgrid 는 포함되지 않음 |

Playground 팁: 근거 이벤트 탭에서 히스토그램을 드래그하면 시간 범위로 좁혀집니다.

> Windows: 터미널 경로가 소문자 드라이브(`c:\…`)로 열려 있으면 Vitest 가 "failed to find the current suite" 로 실패할 수 있습니다.
> `cd C:\Users\...` 처럼 대문자 드라이브로 이동한 뒤 실행하세요.

## 구조

```
src/
  components/AlertGrid.vue          경보 목록(심각도 칩·자동 새로고침) + 상세 패널 배치
  components/AlertDetail.vue        개요 / 근거 이벤트 / JSON
  components/EvidencePanel.vue      근거 이벤트: <SearchGrid> 내장 + 범위·히스토그램·필드 요약
  components/EvidenceHistogram.vue  시간 분포 (드래그 범위 선택)
  utils/alert.ts                    로컬 DataSource, 히스토그램, 쿼리 헬퍼
searchgrid.resolve.ts               @codvill/cod-searchgrid 해석 (패키지 / .searchgrid / 경로)
scripts/sync-searchgrid.mjs         GitHub 소스 동기화
mock-server/                        mock 경보 API
playground/                         데모 앱
tests/
```

## 라이선스

MIT. 국기 표시용 Twemoji Country Flags 폰트(CC BY 4.0, Twemoji)는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 참고.
