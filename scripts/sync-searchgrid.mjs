#!/usr/bin/env node
// COD-SEARCHGRID 소스를 GitHub 에서 받아 .searchgrid/ 에 둔다 (패키지를 설치할 수 없는 환경의 개발용).
//
//   npm run searchgrid:sync                 # main 최신으로 갱신
//   npm run searchgrid:sync -- --ref v0.1.3 # 특정 브랜치/태그/커밋
//   npm run searchgrid:which                # 지금 어떤 COD-SEARCHGRID 가 쓰이는지 출력
//
// 환경 변수 SEARCHGRID_REPO 로 저장소 주소를 바꿀 수 있다.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = resolve(root, '.searchgrid')
const repo = process.env.SEARCHGRID_REPO ?? 'https://github.com/KOSUKJUN/COD-SEARCHGRID.git'
const args = process.argv.slice(2)
const refIdx = args.indexOf('--ref')
const ref = refIdx >= 0 ? args[refIdx + 1] : 'main'

const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim()
const version = (d) => {
  try {
    return JSON.parse(readFileSync(resolve(d, 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

if (args.includes('--which')) {
  const pkg = resolve(root, 'node_modules/@codvill/cod-searchgrid')
  const forced = process.env.SEARCHGRID_SOURCE
  if (forced) console.log(`SEARCHGRID_SOURCE=${forced}`)
  if (existsSync(resolve(pkg, 'package.json'))) console.log(`package : node_modules/@codvill/cod-searchgrid v${version(pkg)}  ← 기본 사용`)
  if (existsSync(resolve(dir, 'src/index.ts')))
    console.log(`local   : .searchgrid v${version(dir)} @ ${git('rev-parse', '--short', 'HEAD')} (${git('log', '-1', '--format=%cs %s')})`)
  if (!existsSync(resolve(pkg, 'package.json')) && !existsSync(resolve(dir, 'src/index.ts')))
    console.log('없음 — npm i -D @codvill/cod-searchgrid 또는 npm run searchgrid:sync')
  process.exit(0)
}

if (!existsSync(resolve(dir, '.git'))) {
  console.log(`[searchgrid] clone ${repo} → .searchgrid`)
  execFileSync('git', ['clone', '--quiet', repo, dir], { cwd: root, stdio: 'inherit' })
}
const before = git('rev-parse', '--short', 'HEAD')
git('fetch', '--quiet', '--tags', 'origin', ref)
// .searchgrid 는 관리용 캐시이므로 로컬 변경 없이 항상 받은 ref 로 맞춘다
git('checkout', '--quiet', '--force', '--detach', 'FETCH_HEAD')
const after = git('rev-parse', '--short', 'HEAD')
console.log(
  `[searchgrid] ${ref} @ ${after} (v${version(dir)}) ${before === after ? '— 변경 없음' : `← ${before}`}\n` +
    `             ${git('log', '-1', '--format=%cs %s')}`,
)
if (existsSync(resolve(root, 'node_modules/@codvill/cod-searchgrid/package.json')))
  console.log('[searchgrid] 참고: node_modules 패키지가 설치되어 있어 그쪽이 우선합니다 (SEARCHGRID_SOURCE=local 로 강제 가능)')
