import React, { useEffect } from 'react'
import { useStore } from './store'
import Toolbar from './components/Toolbar'
import Workspace from './components/Workspace'
import Inspector from './components/Inspector'

export default function App() {
  const screenshots = useStore(s => s.screenshots)
  const selectedId = useStore(s => s.selectedId)
  const selectScreenshot = useStore(s => s.selectScreenshot)

  // Auto-select first screenshot on load
  useEffect(() => {
    if (!selectedId && screenshots[0]) {
      selectScreenshot(screenshots[0].id)
    }
  }, [selectedId, screenshots, selectScreenshot])

  return (
    <div className="app">
      <Toolbar/>
      <Workspace/>
      <Inspector/>
    </div>
  )
}
