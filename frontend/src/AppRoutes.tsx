import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from '@/components/layout/AppLayout'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />} />
      <Route path="/chat/:sessionId" element={<AppLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
