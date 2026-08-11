import { Outlet } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext.tsx'

export default function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  )
}
