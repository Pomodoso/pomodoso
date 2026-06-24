import { useEffect } from 'react'

// Crisp website id — set VITE_CRISP_WEBSITE_ID (Crisp → Settings → Website
// Settings → Setup, the "Website ID"). Leave unset to disable the chat widget.
const CRISP_WEBSITE_ID = import.meta.env.VITE_CRISP_WEBSITE_ID as string | undefined

declare global {
  interface Window {
    $crisp: unknown[]
    CRISP_WEBSITE_ID: string
  }
}

interface UseCrispOptions {
  email?: string | null
  name?: string | null
  open?: boolean
}

/** Loads the Crisp support chat once and (optionally) identifies the user. */
export function useCrisp({ email, name, open }: UseCrispOptions = {}) {
  useEffect(() => {
    if (!CRISP_WEBSITE_ID) return

    if (!window.$crisp) {
      window.$crisp = []
      window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID
      const script = document.createElement('script')
      script.src = 'https://client.crisp.chat/l.js'
      script.async = true
      document.head.appendChild(script)
    }

    if (email) window.$crisp.push(['set', 'user:email', [email]])
    if (name) window.$crisp.push(['set', 'user:nickname', [name]])
    if (open) window.$crisp.push(['do', 'chat:open'])

    return () => {
      if (open && window.$crisp) window.$crisp.push(['do', 'chat:close'])
    }
  }, [email, name, open])
}
