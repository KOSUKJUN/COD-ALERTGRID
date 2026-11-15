/**
 * @codvill/cod-searchgrid 를 어디서 가져올지 결정한다 (vite / vitest 공용).
 *
 * AlertGrid 는 COD-SEARCHGRID 의 코드를 복사하지 않고 항상 `@codvill/cod-searchgrid` 로 import 한다.
 * 그래서 이벤트 상세(필드/Payload/PCAP/JSON, 팝업, Payload 창·Diff …)는 upstream 이 업데이트되면 그대로 따라간다.
 *
 * 해석 순서 (환경 변수 SEARCHGRID_SOURCE 로 강제 가능):
 *   1. package : node_modules/@codvill/cod-searchgrid (사내 레지스트리에서 설치한 배포본) — 기본/운영
 *   2. local   : .searchgrid/ (npm run searchgrid:sync 로 GitHub 에서 받은 소스)          — 사내망 밖 개발용
 *   3. <path>  : 임의 경로의 COD-SEARCHGRID 체크아웃 (예: ../COD-SEARCHGRID, 두 저장소 동시 개발)
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Alias } from 'vite'

const root = import.meta.dirname
const PKG = '@codvill/cod-searchgrid'

export interface SearchGridSource {
  kind: 'package' | 'source'
  dir: string
  version: string
}

function versionOf(dir: string): string {
  try {
    return (JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as { version?: string }).version ?? '?'
  } catch {
    return '?'
  }
}

export function resolveSearchGrid(): SearchGridSource {
  const want = process.env.SEARCHGRID_SOURCE?.trim()
  const pkgDir = resolve(root, 'node_modules', PKG)
  const localDir = resolve(root, '.searchgrid')
  const hasPkg = existsSync(resolve(pkgDir, 'package.json'))
  const isSrc = (d: string) => existsSync(resolve(d, 'src', 'index.ts'))

  if (want && want !== 'package' && want !== 'local') {
    const dir = resolve(root, want)
    if (!isSrc(dir)) throw new Error(`[cod-alertgrid] SEARCHGRID_SOURCE=${want}: ${dir}/src/index.ts 가 없습니다`)
    return { kind: 'source', dir, version: versionOf(dir) }
  }
  if (want !== 'local' && hasPkg) return { kind: 'package', dir: pkgDir, version: versionOf(pkgDir) }
  if (want !== 'package' && isSrc(localDir)) return { kind: 'source', dir: localDir, version: versionOf(localDir) }
  throw new Error(
    `[cod-alertgrid] ${PKG} 를 찾을 수 없습니다.\n` +
      `  · 사내망: npm i -D ${PKG}\n` +
      `  · 그 외 : npm run searchgrid:sync   (GitHub 소스를 .searchgrid/ 로 받음)`,
  )
}

/** 소스 모드일 때만 alias 를 건다 (패키지 모드는 node_modules 해석 그대로) */
export function searchGridAliases(src: SearchGridSource): Alias[] {
  if (src.kind === 'package') return []
  return [
    { find: /^@codvill\/cod-searchgrid\/style\.css$/, replacement: resolve(src.dir, 'src/styles/searchgrid.css') },
    { find: /^@codvill\/cod-searchgrid$/, replacement: resolve(src.dir, 'src/index.ts') },
  ]
}
