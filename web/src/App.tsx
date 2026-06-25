import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext.tsx'
import { ProtectedRoute } from './components/ProtectedRoute.tsx'
import Landing from './pages/Landing.tsx'
import Login from './pages/Login.tsx'
import ResetPassword from './pages/ResetPassword.tsx'
import Dashboard from './pages/dashboard/Dashboard.tsx'
import Billing from './pages/settings/Billing.tsx'
import Pricing from './pages/Pricing.tsx'
import Support from './pages/Support.tsx'
import Privacy from './pages/legal/Privacy'
import Terms from './pages/legal/Terms.tsx'
import Refund from './pages/legal/Refund.tsx'
import Gdpr from './pages/legal/Gdpr.tsx'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/refund" element={<Refund />} />
          <Route path="/gdpr" element={<Gdpr />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/support" element={<Support />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/settings/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
