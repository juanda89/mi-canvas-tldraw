// 1. Importar la librería de tldraw y sus estilos CSS
import { Tldraw } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'

// 2. Este es el componente principal de tu aplicación
export default function App() {
  return (
    // 3. Un contenedor para que el canvas ocupe el 100% de la pantalla
    <div style={{ position: 'fixed', inset: 0 }}>
      {/* 4. El componente de tldraw con nuestras personalizaciones */}
      <Tldraw
        // Forzamos el modo oscuro
        forceDarkMode={true}
        // Activamos la grilla por defecto
        gridMode={true}
      />
    </div>
  )
}