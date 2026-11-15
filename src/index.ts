import type { App, Plugin } from 'vue'
import AlertGrid from './components/AlertGrid.vue'
import AlertDetail from './components/AlertDetail.vue'
import EvidencePanel from './components/EvidencePanel.vue'
import EvidenceHistogram from './components/EvidenceHistogram.vue'

export { AlertGrid, AlertDetail, EvidencePanel, EvidenceHistogram }
export * from './types'
export { DEFAULT_ALERT_MESSAGES, fmt, type AlertMessages } from './messages'
export {
  createLocalSource,
  localHistogram,
  bucketize,
  niceStep,
  timeRangeTokens,
  stripFieldTokens,
  joinQuery,
  formatTime,
  toEpoch,
  countryName,
  flagEmoji,
  formatEndpoint,
} from './utils/alert'

/**
 * app.use(CodAlertGrid) 로 전역 <CodAlertGrid> 등록.
 * 스타일: import '@codvill/cod-searchgrid/style.css' + import '@codvill/cod-alertgrid/style.css'
 */
export const CodAlertGrid: Plugin = {
  install(app: App) {
    app.component('CodAlertGrid', AlertGrid)
  },
}

export default CodAlertGrid
