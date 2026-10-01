import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { // 多入口（2026-10-02 /prep×任務中心整併）：ops-tasks=無登入版任務中心
    main: resolve(__dirname, 'index.html'),
    opsTasks: resolve(__dirname, 'ops-tasks.html'),
  } } },
})
