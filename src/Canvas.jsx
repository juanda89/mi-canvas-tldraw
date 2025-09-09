import { Tldraw, DefaultMainMenu, TldrawUiMenuItem, createTLStore } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { supabase } from './supabaseClient'
import { useState, useEffect, useRef } from 'react'

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

export default function Canvas({ session }) {
  const [editor, setEditor] = useState(null);
  const [store] = useState(() => createTLStore());
  const [loading, setLoading] = useState(true);
  const saveTimeout = useRef(null);

  // --- LÓGICA DE CARGA ---
  useEffect(() => {
    if (!editor) return;

    setLoading(true);

    const loadData = async () => {
      const { data, error } = await supabase
        .from('canvas_states')
        .select('data')
        .eq('user_id', session.user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error cargando el estado:', error);
      }

      if (data && data.data) {
        store.loadSnapshot(data.data);
      }
      setLoading(false);
    };

    loadData();
  }, [editor, session.user.id, store]);

  // --- LÓGICA DE GUARDADO ---
  useEffect(() => {
    if (!editor) return;

    const handleChange = () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }

      saveTimeout.current = setTimeout(async () => {
        const snapshot = store.getSnapshot();
        await supabase
          .from('canvas_states')
          .upsert({ 
            user_id: session.user.id, 
            data: snapshot, 
            updated_at: new Date().toISOString() 
          });
      }, 1000);
    };

    const cleanup = store.listen(handleChange, { source: 'user', scope: 'document' });

    return () => {
      cleanup();
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [editor, session.user.id, store]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        store={store}
        onMount={setEditor}
        overrides={uiOverrides}
        forceDarkMode={true}
        gridMode={true}
      />
      {/* AQUÍ ESTÁ EL CAMBIO PRINCIPAL:
        Mostramos la pantalla de carga como una superposición (overlay) 
        en lugar de bloquear el renderizado del componente Tldraw.
        Cuando 'loading' sea false, este div simplemente no se mostrará.
      */}
      {loading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1e1e1e',
          color: 'white',
          zIndex: 1000 // Para que se muestre por encima del canvas
        }}>
          Cargando canvas...
        </div>
      )}
    </div>
  )
}

