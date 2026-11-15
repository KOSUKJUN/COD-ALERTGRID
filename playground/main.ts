import { createApp } from 'vue'
// 소스 모드에서는 SearchGrid.vue 가 자체 CSS 를 import 하고, 패키지 모드에서는 style.css 가 필요하다
import '@codvill/cod-searchgrid/style.css'
import App from './App.vue'

createApp(App).mount('#app')
