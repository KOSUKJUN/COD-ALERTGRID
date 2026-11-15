import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { resolveSearchGrid, searchGridAliases } from './searchgrid.resolve'

const mockApi = process.env.MOCK_API_URL ?? 'http://localhost:3002'

export default defineConfig(({ command }) => {
  const sg = resolveSearchGrid()
  console.log(`[cod-alertgrid] @codvill/cod-searchgrid ← ${sg.kind} v${sg.version} (${sg.dir})`)
  return {
    plugins: [
      vue(),
      command === 'build' &&
        dts({
          tsconfigPath: './tsconfig.build.json',
          entryRoot: 'src',
          // 소스 모드(.searchgrid)로 빌드해도 d.ts 는 항상 패키지 이름을 참조하게 한다
          beforeWriteFile: (filePath, content) => ({
            filePath,
            content: content.replace(/(['"])(?:\.\.\/)+\.searchgrid\/src\/index(?:\.ts)?\1/g, '$1@codvill/cod-searchgrid$1'),
          }),
        }),
    ],
    resolve: { alias: searchGridAliases(sg) },
    server: {
      host: true,
      port: 5174,
      strictPort: true,
      proxy: { '/api': { target: mockApi, changeOrigin: true } },
    },
    build: {
      lib: {
        entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        name: 'CodAlertGrid',
        fileName: 'cod-alertgrid',
        cssFileName: 'style',
      },
      rollupOptions: {
        // COD-SEARCHGRID 는 번들에 넣지 않는다 → 사용하는 앱에 설치된 버전이 쓰이므로
        // cod-searchgrid 만 업데이트해도 근거 이벤트 상세보기가 함께 업데이트된다.
        external: ['vue', '@codvill/cod-searchgrid', /^@codvill\/cod-searchgrid\//],
        output: {
          exports: 'named',
          globals: { vue: 'Vue', '@codvill/cod-searchgrid': 'CodSearchGrid' },
        },
      },
      sourcemap: true,
    },
  }
})
