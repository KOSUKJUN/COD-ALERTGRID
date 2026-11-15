/**
 * 가짜 경보 + 근거 이벤트 생성기 (시드 고정 → 매번 같은 데이터).
 * mock-server(Node type stripping) 와 playground(로컬 모드, Vite) 양쪽에서 사용한다.
 *
 * 근거 이벤트는 경보별로 필요할 때 생성한다 (수십만 건짜리 경보도 있음).
 */

export type Rec = Record<string, unknown>

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)]
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

const HOSTS = ['web-01', 'web-02', 'api-01', 'db-01', 'dc-01', 'vpn-gw-01', 'mail-01', 'fw-edge-01', 'ws-kim-0412', 'ws-lee-0233']
/** 중요 자산 (목적지) — 호스트별 고정 IP · 자산명 */
const ASSETS: Record<string, { ip: string; name: string }> = {
  "web-01": { ip: "10.0.1.11", name: "대외 웹서버 #1" },
  "web-02": { ip: "10.0.1.12", name: "대외 웹서버 #2" },
  "api-01": { ip: "10.0.2.21", name: "API 게이트웨이" },
  "db-01": { ip: "10.0.3.31", name: "고객정보 DB" },
  "dc-01": { ip: "10.0.4.41", name: "도메인 컨트롤러" },
  "vpn-gw-01": { ip: "10.0.0.5", name: "VPN 게이트웨이" },
  "mail-01": { ip: "10.0.5.51", name: "메일 서버" },
  "fw-edge-01": { ip: "10.0.0.1", name: "경계 방화벽" },
  "ws-kim-0412": { ip: "10.0.8.12", name: "재무팀 PC" },
  "ws-lee-0233": { ip: "10.0.8.33", name: "인사팀 PC" },
}
const USERS = ['admin', 'root', 'alice', 'bob', 'svc_backup', 'kim.minsu', 'lee.jiwon', 'park.hyun']
const EXT_IPS = ['185.220.101.34', '45.155.205.99', '193.142.146.7', '91.240.118.172', '222.186.30.112', '61.177.172.13']
const COUNTRIES: Record<string, string> = {
  '185.220.101.34': 'DE',
  '45.155.205.99': 'RU',
  '193.142.146.7': 'NL',
  '91.240.118.172': 'RU',
  '222.186.30.112': 'CN',
  '61.177.172.13': 'CN',
}
const INT_IP = (r: () => number) => `10.0.${int(r, 1, 9)}.${int(r, 10, 250)}`

interface Scenario {
  rule: string
  /** 경보 대표 목적지 포트 (포트 스캔처럼 여러 포트면 없음) */
  port?: number
  title: (a: Rec) => string
  description: string
  severity: string[]
  /** 근거 이벤트 건수 분포 */
  count: (r: () => number) => number
  /** 근거 이벤트 1건 */
  event: (a: Rec, r: () => number, i: number) => Rec
  /** 발생 기간(분) */
  span: (n: number) => number
}

// --------------------------------------------------------------- payload helpers
function b64(bytes: number[]): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
const ipBytes = (ip: string) => ip.split('.').map(Number)
/** Ethernet + IPv4 + TCP 프레임 (PCAP 분석 탭 확인용) */
function tcpFrame(src: string, dst: string, sport: number, dport: number, flags: number, data: number[] = []): string {
  const total = 20 + 20 + data.length
  const eth = [0x00, 0x1c, 0x42, 0x3a, 0x7b, 0x01, 0x00, 0x50, 0x56, 0xa1, 0x22, 0x33, 0x08, 0x00]
  const ip = [0x45, 0, total >> 8, total & 255, 0x1a, 0x2b, 0x40, 0, 64, 6, 0, 0, ...ipBytes(src), ...ipBytes(dst)]
  let sum = 0
  for (let i = 0; i < 20; i += 2) sum += (ip[i] << 8) | ip[i + 1]
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16)
  const ck = ~sum & 0xffff
  ip[10] = ck >> 8
  ip[11] = ck & 255
  const tcp = [sport >> 8, sport & 255, dport >> 8, dport & 255, 0x12, 0x34, 0x56, 0x78, 0, 0, 0, 0, 0x50, flags, 0xfa, 0xf0, 0, 0, 0, 0]
  return b64([...eth, ...ip, ...tcp, ...data])
}

// --------------------------------------------------------------- scenarios
const SCENARIOS: Scenario[] = [
  {
    rule: 'AUTH-001 SSH Brute Force',
    port: 22,
    title: (a) => `SSH 무차별 대입 공격: ${a.src_ip} → ${a.host}`,
    description:
      '짧은 시간 동안 동일 출발지에서 다수의 SSH 로그인 실패가 발생했습니다.\n임계치: 5분 내 실패 20회 이상. 이후 로그인 성공 여부를 근거 이벤트에서 확인하세요.',
    severity: ['high', 'high', 'critical', 'medium'],
    count: (r) => (r() < 0.06 ? int(r, 20000, 90000) : int(r, 20, 1800)),
    span: (n) => Math.max(5, Math.min(600, Math.round(n / 40))),
    event: (a, r, i) => {
      const ok = i > 0 && r() < 0.004
      const user = r() < 0.6 ? String(a._user) : pick(r, ['root', 'admin', 'test', 'oracle', 'ubuntu'])
      const port = int(r, 30000, 65000)
      return {
        sourcetype: 'linux:secure',
        action: ok ? 'success' : 'failure',
        severity: ok ? 'critical' : 'medium',
        user,
        dest_port: 22,
        src_port: port,
        message: ok
          ? `Accepted password for ${user} from ${a.src_ip} port ${port} ssh2`
          : `Failed password for ${r() < 0.2 ? 'invalid user ' : ''}${user} from ${a.src_ip} port ${port} ssh2`,
        payload: `sshd[${int(r, 1000, 9999)}]: ${ok ? 'Accepted' : 'Failed'} password for ${user} from ${a.src_ip} port ${port} ssh2`,
      }
    },
  },
  {
    rule: 'NET-014 Horizontal/Vertical Port Scan',
    title: (a) => `포트 스캔 탐지: ${a.src_ip}`,
    description: '단일 출발지가 다수의 목적지 포트로 SYN 패킷을 전송했습니다. 패킷 payload 는 PCAP 분석 탭에서 확인할 수 있습니다.',
    severity: ['medium', 'low', 'high'],
    count: (r) => int(r, 200, 6000),
    span: (n) => Math.max(2, Math.round(n / 300)),
    event: (a, r) => {
      const dport = r() < 0.5 ? pick(r, [21, 22, 23, 25, 53, 80, 110, 139, 443, 445, 1433, 3306, 3389, 5432, 8080]) : int(r, 1, 65535)
      const sport = int(r, 40000, 60000)
      return {
        sourcetype: 'netflow:pcap',
        action: r() < 0.85 ? 'blocked' : 'allowed',
        severity: 'low',
        dest_port: dport,
        src_port: sport,
        message: `TCP SYN ${a.src_ip}:${sport} -> ${a.dest_ip}:${dport}`,
        payload: tcpFrame(String(a.src_ip), String(a.dest_ip), sport, dport, 0x02),
        payload_encoding: 'base64',
      }
    },
  },
  {
    rule: 'WEB-102 SQL Injection Attempt',
    port: 443,
    title: (a) => `SQL Injection 시도: ${a.host}`,
    description: '웹 요청 파라미터에서 SQL 구문 패턴(UNION SELECT, OR 1=1, SLEEP 등)이 탐지되었습니다.',
    severity: ['high', 'medium', 'critical'],
    count: (r) => int(r, 3, 900),
    span: (n) => Math.max(3, Math.round(n / 6)),
    event: (a, r) => {
      const inj = pick(r, ["' OR '1'='1", "1 UNION SELECT username,password FROM users--", "1' AND SLEEP(5)--", "admin'--", "1;DROP TABLE orders"])
      const path = pick(r, ['/api/v1/products', '/login', '/board/view', '/search', '/api/v1/orders'])
      const status = r() < 0.15 ? 500 : r() < 0.6 ? 403 : 200
      const ua = pick(r, ['sqlmap/1.8.2#stable', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'python-requests/2.31'])
      const q = encodeURIComponent(inj)
      return {
        sourcetype: 'waf:access',
        action: status === 403 ? 'blocked' : 'allowed',
        severity: status === 200 ? 'high' : 'medium',
        dest_port: 443,
        http_status: status,
        url: `${path}?id=${q}`,
        message: `GET ${path}?id=${inj} ${status}`,
        payload: `GET ${path}?id=${q} HTTP/1.1\r\nHost: ${a.host}.corp.example\r\nUser-Agent: ${ua}\r\nAccept: */*\r\nX-Forwarded-For: ${a.src_ip}\r\n\r\n`,
      }
    },
  },
  {
    rule: 'EDR-033 Credential Dumping (LSASS access)',
    port: 445,
    title: (a) => `자격 증명 덤프 의심: ${a.dest_asset}`,
    description: 'lsass.exe 메모리에 대한 비정상 접근(PROCESS_VM_READ)이 탐지되었습니다. Mimikatz 등 도구 사용이 의심됩니다.',
    severity: ['critical', 'high'],
    count: (r) => int(r, 1, 12),
    span: () => 3,
    event: (a, r) => {
      const img = pick(r, ['C:\\Users\\Public\\m64.exe', 'C:\\Windows\\Temp\\procdump64.exe', 'C:\\Windows\\System32\\rundll32.exe'])
      return {
        sourcetype: 'XmlWinEventLog:Sysmon',
        action: 'process_access',
        severity: 'critical',
        process: img,
        message: `Process ${img} accessed lsass.exe (GrantedAccess 0x1010)`,
        payload: `<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event"><System><EventID>10</EventID><Computer>${a.host}.corp.example</Computer></System><EventData><Data Name="SourceImage">${img}</Data><Data Name="TargetImage">C:\\Windows\\system32\\lsass.exe</Data><Data Name="GrantedAccess">0x1010</Data><Data Name="SourceUser">CORP\\${a._user}</Data></EventData></Event>`,
      }
    },
  },
  {
    rule: 'DNS-007 DNS Tunneling Suspected',
    port: 53,
    title: (a) => `DNS 터널링 의심: ${a.host}`,
    description: '긴 서브도메인과 높은 엔트로피를 가진 DNS 질의가 단일 도메인으로 반복 전송되었습니다.',
    severity: ['medium', 'high'],
    count: (r) => (r() < 0.1 ? int(r, 30000, 120000) : int(r, 100, 4000)),
    span: (n) => Math.max(10, Math.min(900, Math.round(n / 60))),
    event: (a, r) => {
      const label = Array.from({ length: int(r, 30, 60) }, () => pick(r, [...'abcdefghijklmnopqrstuvwxyz0123456789'])).join('')
      const q = `${label}.t.evil-cdn.net`
      return {
        sourcetype: 'dns:query',
        action: 'allowed',
        severity: 'medium',
        dest_port: 53,
        query: q,
        message: `DNS query ${q} TXT from ${a.dest_ip}`,
        payload: q,
      }
    },
  },
  {
    rule: 'DLP-021 Large Outbound Transfer',
    port: 443,
    title: (a) => `대용량 외부 전송: ${a.dest_asset} → ${a.src_ip}`,
    description: '업무 시간 외 외부 IP 로 평소 대비 30배 이상의 데이터가 전송되었습니다.',
    severity: ['high', 'medium'],
    count: (r) => int(r, 10, 400),
    span: (n) => Math.max(10, n),
    event: (a, r) => {
      const bytes = int(r, 2_000_000, 80_000_000)
      return {
        sourcetype: 'proxy:access',
        action: 'allowed',
        severity: bytes > 50_000_000 ? 'high' : 'medium',
        dest_port: 443,
        bytes,
        message: `CONNECT ${a.src_ip}:443 bytes_out=${bytes}`,
        payload: `CONNECT ${a.src_ip}:443 HTTP/1.1\r\nHost: ${a.src_ip}:443\r\nProxy-Authorization: Basic ****\r\nUser-Agent: rclone/v1.66\r\n\r\n`,
      }
    },
  },
]

/** 데이터 기준 시각: 서버/페이지 시작 시각(분 단위) — 목록의 "n분 전" 표시가 자연스럽도록 */
export const NOW = Math.floor(Date.now() / 60_000) * 60_000 - 60_000

export function generateAlerts(n = 2000, seed = 20261115): Rec[] {
  const r = rng(seed)
  const out: Rec[] = []
  for (let i = 0; i < n; i++) {
    const sc = r() < 0.32 ? SCENARIOS[0] : pick(r, SCENARIOS)
    const scIndex = SCENARIOS.indexOf(sc)
    let count = sc.count(r)
    let stored = count
    // 대량 근거 이벤트 데모용 고정 경보
    if (i === 0) count = stored = 250_000
    if (i === 3) {
      count = 500_000
      stored = 120_000 // 보관 정책으로 일부만 저장된 경우
    }
    const spanMin = i === 0 || i === 3 ? 720 : sc.span(count)
    const last = NOW - Math.floor(Math.pow(r(), 1.6) * 14 * 86400_000)
    const first = last - spanMin * 60_000
    const src = pick(r, EXT_IPS)
    const host = pick(r, HOSTS)
    const a: Rec = {
      alert_id: `ALT-${String(100000 + i)}`,
      _time: new Date(last).toISOString(),
      first_seen: new Date(first).toISOString(),
      last_seen: new Date(last).toISOString(),
      rule_name: sc.rule,
      severity: i === 0 || i === 3 ? 'critical' : pick(r, sc.severity),
      host,
      _user: pick(r, USERS),
      src_ip: src,
      src_port: int(r, 32768, 65535),
      dest_ip: ASSETS[host].ip,
      dest_port: sc.port,
      dest_asset: ASSETS[host].name,
      src_country: COUNTRIES[src],
      evidence_count: count,
      evidence_stored: stored,
      description: sc.description,
      _scenario: scIndex,
      _seed: Math.floor(r() * 2 ** 31),
    }
    a.title = sc.title(a)
    out.push(a)
  }
  return out.sort((x, y) => (String(y._time) < String(x._time) ? -1 : 1))
}

/** 경보 1건의 근거 이벤트 (시간 오름차순) */
export function generateEvidence(alert: Rec): Rec[] {
  const sc = SCENARIOS[Number(alert._scenario)]
  const r = rng(Number(alert._seed))
  const n = Number(alert.evidence_stored ?? alert.evidence_count)
  const t0 = Date.parse(String(alert.first_seen))
  const t1 = Date.parse(String(alert.last_seen))
  const span = Math.max(1, t1 - t0)
  const out: Rec[] = new Array(n)
  // 버스트 형태의 시간 분포
  const bursts = Array.from({ length: int(r, 1, 4) }, () => ({ c: r(), w: 0.04 + r() * 0.25 }))
  for (let i = 0; i < n; i++) {
    const b = bursts[i % bursts.length]
    const u = Math.min(1, Math.max(0, b.c + (r() + r() + r() - 1.5) * b.w))
    const t = t0 + Math.floor(u * span)
    out[i] = {
      _time: new Date(t).toISOString(),
      event_id: `${String(alert.alert_id)}-E${String(i + 1).padStart(6, '0')}`,
      host: alert.host,
      src_ip: alert.src_ip,
      dest_ip: alert.dest_ip,
      user: alert._user,
      is_evidence: true,
      geo: { country: alert.src_country ?? 'KR' },
      ...sc.event(alert, r, i),
    }
  }
  out.sort((a, b) => (String(a._time) < String(b._time) ? -1 : 1))
  out.forEach((e, i) => (e.event_id = `${String(alert.alert_id)}-E${String(i + 1).padStart(6, '0')}`))
  return out
}

/** 경보 시각 ±maxMinutes 의 주변(문맥) 이벤트 — 같은 호스트의 일반 로그 */
export function generateContext(alert: Rec, maxMinutes = 240): Rec[] {
  const r = rng(Number(alert._seed) ^ 0x5bd1e995)
  const t = Date.parse(String(alert._time))
  const from = Date.parse(String(alert.first_seen)) - maxMinutes * 60_000
  const to = t + maxMinutes * 60_000
  const n = Math.min(20000, Math.round(((to - from) / 60_000) * 3))
  const out: Rec[] = []
  for (let i = 0; i < n; i++) {
    const ts = from + Math.floor(r() * (to - from))
    const kind = r()
    out.push({
      _time: new Date(ts).toISOString(),
      event_id: `${String(alert.alert_id)}-C${String(i + 1).padStart(6, '0')}`,
      host: alert.host,
      is_evidence: false,
      sourcetype: kind < 0.4 ? 'linux:syslog' : kind < 0.7 ? 'web:access' : 'fw:traffic',
      action: r() < 0.9 ? 'allowed' : 'blocked',
      severity: r() < 0.85 ? 'info' : 'low',
      user: r() < 0.5 ? alert._user : pick(r, USERS),
      src_ip: r() < 0.15 ? alert.src_ip : INT_IP(r),
      dest_ip: alert.dest_ip,
      dest_port: pick(r, [22, 53, 80, 123, 443, 445, 3306, 8080]),
      message:
        kind < 0.4
          ? `CRON[${int(r, 1000, 9999)}]: (${pick(r, USERS)}) CMD (run-parts /etc/cron.hourly)`
          : kind < 0.7
            ? `GET /static/app.${int(r, 1, 9)}.js 200`
            : `ACCEPT TCP ${INT_IP(r)} -> ${String(alert.dest_ip)}`,
    })
  }
  return out
}
