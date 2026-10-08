import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The plugin's WebView has no service worker; the shell is inside the plugin binary.
if (import.meta.env.MODE !== 'plugin') void import('./sw/register').then((m) => m.registerServiceWorker())
