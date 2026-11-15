import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolveSearchGrid, searchGridAliases } from './searchgrid.resolve'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: searchGridAliases(resolveSearchGrid()) },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts'],
    css: true,
  },
})
