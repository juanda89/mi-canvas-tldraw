import { Tldraw, DefaultMainMenu, TldrawUiMenuItem, useEditor, createTLStore } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { supabase } from './supabaseClient'
import { useState, useEffect, useRef } from 'react'

// El menú personalizado no cambia, está bien como estaba.
const MyMainMenu = () => {
  const handleSignOut = () => {
    supabase.auth.signOut()
  }

  return (
    <DefaultMainMenu>
      <TldrawUiMenuItem
        id="sign-out"
        label="Cerrar Sesión"
        onSelect={handleSignOut}
      />
    </DefaultMainMenu>
  )
}

const uiOverrides = {
  mainMenu: MyMainMenu,
}

// --- El componente principal del Canvas, ahora más robusto ---
export default function Canvas({ session }) {
  // Guardamos la instancia del editor en el estado de React para un manejo más fiable.
  const [editor, setEditor] = useState(null);
  
  // Creamos el store de tldraw dentro del ciclo de vida del componente.
  const [store] = useState(() => createTLStore());
  
  const [loading, setLoading] = useState(true);

  // Usamos una referencia para el temporizador del debounce.
  const saveTimeout = useRef(null);

  // --- LÓGICA DE CARGA ---
  // Este efecto se ejecuta solo cuando el 'editor' está disponible.
  useEffect(() => {
    if (!editor) return;

    setLoading(true);

    const loadData = async () => {
      const { data, error } = await supabase
        .from('canvas_states')
        .select('data')
        .eq('user_id', session.user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // Ignora el error "no rows found"
        console.error('Error cargando el estado:', error);
      }

      if (data && data.data) {
        // Carga el snapshot en el store del editor
        store.loadSnapshot(data.data);
      }
      setLoading(false);
    };

    loadData();
  }, [editor, session.user.id, store]); // Dependencias correctas

  // --- LÓGICA DE GUARDADO ---
  // Este efecto configura el listener de cambios y el debounce para guardar.
  useEffect(() => {
    if (!editor) return;

    const handleChange = () => {
      // Si ya hay un guardado programado, lo cancelamos.
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }

      // Programamos un nuevo guardado para dentro de 1 segundo.
      saveTimeout.current = setTimeout(async () => {
        const snapshot = store.getSnapshot();
        const { error } = await supabase
          .from('canvas_states')
          .upsert({ 
            user_id: session.user.id, 
            data: snapshot, 
            updated_at: new Date().toISOString() 
          });

        if (error) {
          console.error('Error guardando el estado:', error);
        }
      }, 1000); // Debounce de 1 segundo
    };

    // Escuchamos solo los cambios hechos por el usuario en el documento.
    const cleanup = store.listen(handleChange, { source: 'user', scope: 'document' });

    // Función de limpieza: se ejecuta cuando el componente se desmonta.
    return () => {
      cleanup();
      // Aseguramos que no queden temporizadores pendientes.
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [editor, session.user.id, store]); // Dependencias correctas

  if (loading) {
    return <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#1e1e1e', color: 'white'}}>Cargando canvas...</div>;
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        // Pasamos nuestro store local al componente
        store={store}
        // Cuando el editor se monta, lo guardamos en nuestro estado
        onMount={setEditor}
        overrides={uiOverrides}
        forceDarkMode={true}
        gridMode={true}
      />
    </div>
  )
}

