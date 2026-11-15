import type { GridColumn, LogRecord, SearchRequest, SearchResult } from '@codvill/cod-searchgrid'

/** 경보 레코드 (필드명은 AlertFieldMap 으로 매핑) */
export type AlertRecord = LogRecord

/** 경보 필드 매핑 — 백엔드 스키마가 다르면 바꿔서 사용 */
export interface AlertFieldMap {
  id: string
  time: string
  title: string
  severity: string
  rule: string
  description: string
  /** 근거 이벤트 건수 (목록에서 근거 이벤트를 로드하지 않고 표시) */
  evidenceCount: string
  /** 로컬 근거 이벤트 배열 (evidenceSource 미지정 시 사용) */
  evidence: string
  firstSeen: string
  lastSeen: string
  /** Source IP */
  srcIp: string
  /** Source Port */
  srcPort: string
  /** Source 국가 (ISO 3166 alpha-2 코드 → 국기 + 국가명, 또는 국가명) */
  srcCountry: string
  /** Destination IP */
  destIp: string
  /** Destination Port */
  destPort: string
  /** Destination 중요 자산 이름 (없으면 destHost) */
  destAsset: string
  /** Destination 호스트명 */
  destHost: string
}

export const DEFAULT_FIELD_MAP: AlertFieldMap = {
  id: 'alert_id',
  time: '_time',
  title: 'title',
  severity: 'severity',
  rule: 'rule_name',
  description: 'description',
  evidenceCount: 'evidence_count',
  evidence: 'evidence',
  firstSeen: 'first_seen',
  lastSeen: 'last_seen',
  srcIp: 'src_ip',
  srcPort: 'src_port',
  srcCountry: 'src_country',
  destIp: 'dest_ip',
  destPort: 'dest_port',
  destAsset: 'dest_asset',
  destHost: 'host',
}

/** 경보에서 추출해 보여줄 엔티티 (Sentinel Entities 방식) */
export interface EntityDef {
  /** 경보 레코드의 필드 */
  field: string
  /** 표시 종류 */
  type: 'host' | 'user' | 'ip' | 'process' | 'file' | 'url' | 'hash' | string
  label?: string
  /** 근거 이벤트에서 같은 값을 찾을 필드 (기본: field) */
  evidenceField?: string
}

/**
 * 근거 이벤트 범위
 *  - evidence: 경보를 발생시킨 근거 이벤트만
 *  - context : 경보 시각 전후 contextMinutes 분의 관련 이벤트 (Splunk drill-down earliest/latest offset 방식)
 */
export type EvidenceScope = 'evidence' | 'context'

/** 근거 이벤트 요청 = COD-SEARCHGRID SearchRequest + 경보 정보 */
export interface EvidenceRequest extends SearchRequest {
  alert: AlertRecord
  scope: EvidenceScope
  contextMinutes: number
}

/**
 * 근거 이벤트 원격 소스. SearchGrid DataSource 와 같은 프로토콜
 * (offset/limit 페이징, groupBy 집계, sort, signal) 에 alert/scope 가 추가된다.
 */
export type EvidenceSource = (req: EvidenceRequest) => Promise<SearchResult>

export interface HistogramBucket {
  /** 구간 시작 (epoch ms) */
  start: number
  /** 구간 끝 (epoch ms, 미포함) */
  end: number
  count: number
}

export interface HistogramRequest {
  alert: AlertRecord
  /** 근거 이벤트 그리드의 현재 검색어 */
  query: string
  scope: EvidenceScope
  contextMinutes: number
  /** 원하는 구간 수 */
  buckets: number
  signal?: AbortSignal
}

/** 근거 이벤트 시간 분포 (미지정 + 원격이면 히스토그램 숨김) */
export type HistogramFn = (req: HistogramRequest) => Promise<HistogramBucket[]>

/** '검색 화면에서 열기' (근거 이벤트를 전체 검색 화면으로 pivot) */
export interface OpenInSearchContext {
  alert: AlertRecord
  query: string
  scope: EvidenceScope
  contextMinutes: number
}

export type DetailLayout = 'right' | 'bottom'

export type AlertDetailTab = 'overview' | 'evidence' | 'json'

export type AlertTheme = 'light' | 'dark'

/** 근거 이벤트 패널 설정 */
export interface EvidenceOptions {
  columns: GridColumn[]
  /** 상단 필드 요약(Top N) 대상 필드 */
  facets: string[]
  /** 근거 이벤트 시간 필드 */
  timeField: string
  /** context 범위에서 근거 이벤트 여부를 나타내는 필드 */
  markerField: string
  rowKey?: string
}

export type { GridColumn, LogRecord, SearchRequest, SearchResult }
