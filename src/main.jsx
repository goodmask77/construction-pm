import React from 'react'
import { createRoot } from 'react-dom/client'
import { installStorageShim } from './supa.js'
import App from './App.jsx'

// 安裝 window.storage 墊片（Supabase 共享 + localStorage 個人）後再掛載 App
installStorageShim()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
