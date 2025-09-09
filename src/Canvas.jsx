import { Tldraw, DefaultMainMenu, TldrawUiMenuItem } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { supabase } from './supabaseClient'
import { useState, useRef, useCallback } from 'react'

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
  const [loading, setLoading] = useState(true);
  const saveTimeout = useRef(null);
  const hasLoadedData = useRef(false);

  // Función para cargar datos del usuario
  const loadUserData = useCallback(async (editor) => {
    if (hasLoadedData.current) return;
    
    try {
      const { data, error } = await supabase
        .from('canvas_states')
        .select('data')
        .eq('user_id', session.user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error cargando el estado:', error);
        return;
      }

      if (data && data.data) {
        // CORRECCIÓN: Usar editor.loadSnapshot en lugar de store.loadSnapshot
        editor.loadSnapshot(data.data);
      }
      
      hasLoadedData.current = true;
    } catch (error) {
      console.error('Error al cargar datos:', error);
    } finally {
      setLoading(false);
    }
  }, [session.user.id]);

  // Función para guardar datos
  const saveUserData = useCallback(async (editor) => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }

    saveTimeout.current = setTimeout(async () => {
      try {
        // CORRECCIÓN: Usar editor.getSnapshot en lugar de store.getSnapshot
        const snapshot = editor.getSnapshot();
        
        await supabase
          .from('canvas_states')
          .upsert({ 
            user_id: session.user.id, 
            data: snapshot, 
            updated_at: new Date().toISOString() 
          });
      } catch (error) {
        console.error('Error guardando datos:', error);
      }
    }, 1000);
  }, [session.user.id]);

  // Función que se ejecuta cuando el editor está listo
  const handleMount = useCallback(async (editor) => {
    // Configurar dark mode y grid por defecto
    const currentPrefs = editor.user.getUserPreferences();
    
    // Solo aplicar dark mode si no tiene preferencia configurada
    if (currentPrefs.colorScheme === 'system') {
      editor.user.updateUserPreferences({ 
        colorScheme: 'dark' 
      });
    }
    
    // Siempre activar grid al iniciar
    editor.updateInstanceState({ 
      isGridMode: true 
    });

    // Cargar datos del usuario
    await loadUserData(editor);

    // CORRECCIÓN: Configurar listener correctamente usando editor.store.listen
    const cleanup = editor.store.listen(() => {
      if (!loading && hasLoadedData.current) {
        saveUserData(editor);
      }
    }, { source: 'user', scope: 'document' });

    // Cleanup cuando el componente se desmonte
    return () => {
      cleanup();
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [loadUserData, saveUserData, loading]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        // CORRECCIÓN: Remover store personalizado, usar persistenceKey en su lugar
        persistenceKey={`user-${session.user.id}`}
        onMount={handleMount}
        overrides={uiOverrides}
        // CORRECCIÓN: Usar inferDarkMode en lugar de forceDarkMode
        inferDarkMode
      />
      
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
          zIndex: 1000
        }}>
          Cargando canvas...
        </div>
      )}
    </div>
  )
}