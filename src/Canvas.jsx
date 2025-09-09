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
  const [debugInfo, setDebugInfo] = useState([]);
  const saveTimeout = useRef(null);
  const hasLoadedData = useRef(false);
  const editorRef = useRef(null);
  const isFirstLoad = useRef(true);

  // Función de debug para trackear todo lo que pasa
  const addDebugInfo = useCallback((message, data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    const debugEntry = {
      time: timestamp,
      message,
      data: data ? JSON.stringify(data, null, 2) : null
    };
    
    console.log(`🐛 [${timestamp}] ${message}`, data || '');
    setDebugInfo(prev => [...prev, debugEntry]);
  }, []);

  // Función para verificar estado de Supabase
  const checkSupabaseConnection = useCallback(async () => {
    try {
      addDebugInfo('🔍 Verificando conexión a Supabase...');
      
      // Test de conexión básica
      const { data, error } = await supabase
        .from('canvas_states')
        .select('count', { count: 'exact', head: true })
        .eq('user_id', session.user.id);

      if (error) {
        addDebugInfo('❌ Error de conexión a Supabase', error);
        return false;
      }

      addDebugInfo('✅ Conexión a Supabase OK', { count: data });
      return true;
    } catch (error) {
      addDebugInfo('❌ Error inesperado en Supabase', error);
      return false;
    }
  }, [session.user.id, addDebugInfo]);

  // Función para cargar datos del usuario
  const loadUserData = useCallback(async (editor) => {
    if (hasLoadedData.current) {
      addDebugInfo('⏭️ Datos ya cargados, skipping...');
      return;
    }
    
    try {
      addDebugInfo('📥 Iniciando carga de datos del usuario...');
      
      // Verificar conexión primero
      const isConnected = await checkSupabaseConnection();
      if (!isConnected) {
        addDebugInfo('❌ No se pudo conectar a Supabase');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('canvas_states')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          addDebugInfo('ℹ️ No hay datos guardados (primera vez)', error);
        } else {
          addDebugInfo('❌ Error cargando datos', error);
        }
        hasLoadedData.current = true;
        setLoading(false);
        return;
      }

      if (data && data.data) {
        addDebugInfo('📊 Datos encontrados, cargando snapshot...', {
          recordId: data.id,
          dataSize: JSON.stringify(data.data).length,
          updatedAt: data.updated_at
        });

        try {
          // Validar que el snapshot tenga la estructura correcta
          if (!data.data.store || !data.data.schema) {
            addDebugInfo('⚠️ Snapshot inválido, estructura incorrecta', data.data);
          } else {
            editor.loadSnapshot(data.data);
            addDebugInfo('✅ Snapshot cargado exitosamente');
          }
        } catch (snapshotError) {
          addDebugInfo('❌ Error al cargar snapshot', snapshotError);
        }
      } else {
        addDebugInfo('ℹ️ No hay datos para cargar');
      }
      
      hasLoadedData.current = true;
    } catch (error) {
      addDebugInfo('❌ Error inesperado cargando datos', error);
    } finally {
      setLoading(false);
      addDebugInfo('🏁 Carga completada');
    }
  }, [session.user.id, addDebugInfo, checkSupabaseConnection]);

  // Función para guardar datos
  const saveUserData = useCallback(async (editor) => {
    if (!hasLoadedData.current) {
      addDebugInfo('⏭️ Datos no cargados aún, no guardando...');
      return;
    }

    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      addDebugInfo('⏰ Cancelando guardado anterior...');
    }

    saveTimeout.current = setTimeout(async () => {
      try {
        addDebugInfo('💾 Iniciando guardado...');
        
        const snapshot = editor.getSnapshot();
        
        // Validar snapshot antes de guardar
        if (!snapshot || !snapshot.store) {
          addDebugInfo('❌ Snapshot inválido, no guardando', snapshot);
          return;
        }

        const dataSize = JSON.stringify(snapshot).length;
        addDebugInfo('📊 Preparando datos para guardar', {
          dataSize,
          storeKeys: Object.keys(snapshot.store || {}),
          hasSchema: !!snapshot.schema
        });

        const { data, error } = await supabase
          .from('canvas_states')
          .upsert({ 
            user_id: session.user.id, 
            data: snapshot, 
            updated_at: new Date().toISOString() 
          })
          .select();

        if (error) {
          addDebugInfo('❌ Error guardando en Supabase', error);
        } else {
          addDebugInfo('✅ Datos guardados exitosamente', {
            recordId: data[0]?.id,
            dataSize
          });
        }
      } catch (error) {
        addDebugInfo('❌ Error inesperado guardando', error);
      }
    }, 1000);
  }, [session.user.id, addDebugInfo]);

  // Función que se ejecuta cuando el editor está listo
  const handleMount = useCallback(async (editor) => {
    editorRef.current = editor;
    
    addDebugInfo('🚀 Editor montado', {
      userId: session.user.id,
      isFirstLoad: isFirstLoad.current
    });

    // Configurar preferencias iniciales
    try {
      const currentPrefs = editor.user.getUserPreferences();
      addDebugInfo('👤 Preferencias actuales', currentPrefs);
      
      // Solo aplicar dark mode si no tiene preferencia configurada
      if (currentPrefs.colorScheme === 'system') {
        editor.user.updateUserPreferences({ 
          colorScheme: 'dark' 
        });
        addDebugInfo('🌙 Dark mode aplicado');
      }
      
      // Siempre activar grid al iniciar
      editor.updateInstanceState({ 
        isGridMode: true 
      });
      addDebugInfo('📐 Grid activado');

    } catch (error) {
      addDebugInfo('❌ Error configurando preferencias', error);
    }

    // Cargar datos del usuario
    await loadUserData(editor);

    // Configurar listener DESPUÉS de cargar los datos
    let changeCount = 0;
    const cleanup = editor.store.listen(() => {
      changeCount++;
      addDebugInfo(`🔄 Cambio detectado #${changeCount}`, {
        loading,
        hasLoadedData: hasLoadedData.current,
        isFirstLoad: isFirstLoad.current
      });

      // Solo guardar si ya terminamos de cargar y no es la primera carga
      if (!loading && hasLoadedData.current && !isFirstLoad.current) {
        addDebugInfo('💾 Triggering save...');
        saveUserData(editor);
      } else {
        addDebugInfo('⏭️ No guardando porque:', {
          loading,
          hasLoadedData: hasLoadedData.current,
          isFirstLoad: isFirstLoad.current
        });
      }
    }, { source: 'user', scope: 'document' });

    // Marcar que ya no es la primera carga después de un delay
    setTimeout(() => {
      isFirstLoad.current = false;
      addDebugInfo('✅ Primera carga completada, guardado automático habilitado');
    }, 2000);

    addDebugInfo('👂 Listener configurado');

    // Cleanup cuando el componente se desmonte
    return () => {
      addDebugInfo('🧹 Cleanup ejecutado');
      cleanup();
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [loadUserData, saveUserData, loading, session.user.id, addDebugInfo]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        persistenceKey={`user-${session.user.id}`}
        onMount={handleMount}
        overrides={uiOverrides}
        inferDarkMode
      />
      
      {/* Panel de Debug */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        width: '300px',
        maxHeight: '400px',
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        color: 'white',
        padding: '10px',
        borderRadius: '8px',
        fontSize: '12px',
        overflow: 'auto',
        zIndex: 1001,
        fontFamily: 'monospace'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>
          🐛 Debug Info ({debugInfo.length})
        </div>
        <div style={{ marginBottom: '10px' }}>
          Status: {loading ? '⏳ Loading' : '✅ Ready'}
        </div>
        {debugInfo.slice(-10).reverse().map((info, index) => (
          <div key={index} style={{ 
            marginBottom: '5px', 
            borderBottom: '1px solid #333',
            paddingBottom: '5px'
          }}>
            <div style={{ fontWeight: 'bold' }}>
              [{info.time}] {info.message}
            </div>
            {info.data && (
              <pre style={{ 
                whiteSpace: 'pre-wrap', 
                fontSize: '10px',
                maxHeight: '100px',
                overflow: 'auto',
                backgroundColor: '#222',
                padding: '5px',
                marginTop: '5px'
              }}>
                {info.data}
              </pre>
            )}
          </div>
        ))}
      </div>
      
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