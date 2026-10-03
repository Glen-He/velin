import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

document.documentElement.dataset.theme = /^\/(account|security)(\/|$)/.test(
  window.location.pathname,
)
  ? 'system'
  : 'light'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('缺少认证页面根节点。')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
