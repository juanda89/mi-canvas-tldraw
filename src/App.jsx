import { Tldraw, useEditor } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { useEffect } from 'react'

// Un componente que se ejecuta una vez para configurar el estado inicial
function SetInitialState() {
  const editor = useEditor()

  useEffect(() => {
    if (!editor) return

    // 1. Forzar el modo oscuro
    editor.user.updateUserPreferences({ colorScheme: 'dark' })

    // 2. Activar la grilla
    editor.updateInstanceState({ isGridMode: true })

  }, [editor])

  return null
}

// El componente principal de la aplicación
export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw>
        {/* Este componente se encargará de la configuración inicial */}
        <SetInitialState />
      </Tldraw>
    </div>
  )
}
