import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Netlify에서 필요할 수 있는 기본 경로 설정 (선택 사항이지만 안전함)
  base: '/', 
})
