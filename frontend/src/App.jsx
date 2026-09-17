import { HashRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import EditorPage from './pages/EditorPage'
import UpdatePrompt from './components/UpdatePrompt'
import InteractiveTour from './components/InteractiveTour'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/editor" element={<EditorPage />} />
      </Routes>
      <UpdatePrompt />
      <InteractiveTour />
    </HashRouter>
  )
}
