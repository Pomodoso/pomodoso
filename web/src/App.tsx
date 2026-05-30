import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Privacy from './pages/legal/Privacy'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </BrowserRouter>
  )
}
