import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { CopilotKit } from '@copilotkit/react-core/v2'
import { HttpAgent } from '@ag-ui/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import { AppRoutes } from './AppRoutes.tsx'

const agentUrl = import.meta.env.VITE_AGENT_URL || 'http://localhost:8000/agui'

const novaeAgent = new HttpAgent({
  url: agentUrl,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <CopilotKit
        agents__unsafe_dev_only={{ default: novaeAgent }}
        agent="default"
        enableInspector={true}
      >
        <TooltipProvider>
          <AppRoutes />
        </TooltipProvider>
      </CopilotKit>
    </BrowserRouter>
  </StrictMode>,
)
