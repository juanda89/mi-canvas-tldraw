import { Tldraw, DefaultMainMenu, TldrawUiMenuItem, createTLStore } from '@tldraw/tldraw'
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
  
  // ✅ SOLUCIÓN: Crear store limpio sin persistenceKey
  const [store] = useState(() => {
    const cleanStore = createTLStore();
    // Limpiar cualquier persistencia local que pueda interferir
    try {
      localStorage.removeItem(`tldraw_store_user-${session.user.id}`);
      localStorage.removeItem(`tldraw_document_user-${session.user.id}`);
      localStorage.removeItem(`tldraw_state_user-${session.user.id}`);
    } catch (e) {
      console.warn('Could not clear localStorage:', e);
    }
    return cleanStore;
  });

  // Función de debug
  const addDebugInfo = useCallback((message, data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    const debugEntry = {
      time: timestamp,
      message,
      data: data ? JSON.stringify(data, null, 2) : null
    };
    
    console.log(`🐛 [${timestamp}] ${message}`, data || '');
    setDebugInfo(prev => [...prev.slice(-20), debugEntry]); // Keep last 20 entries
  }, []);

  // Función para cargar datos del usuario
  const loadUserData = useCallback(async (editor) => {
    if (hasLoadedData.current) {
      addDebugInfo('⏭️ Datos ya cargados, skipping...');
      return;
    }
    
    try {
      addDebugInfo('📥 Iniciando carga de datos de Supabase...');
      
      const { data, error } = await supabase
        .from('canvas_states')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          addDebugInfo('ℹ️ Usuario nuevo - No hay datos guardados');
        } else {
          addDebugInfo('❌ Error cargando datos', error);
        }
        hasLoadedData.current = true;
        setLoading(false);
        return;
      }

      if (data && data.data) {
        addDebugInfo('📊 Datos encontrados en Supabase', {
          recordId: data.id,
          dataSize: JSON.stringify(data.data).length,
          shapesCount: Object.keys(data.data.store || {}).filter(k => k.startsWith('shape:')).length,
          updatedAt: data.updated_at
        });

        try {
          // Verificar estructura del snapshot
          if (!data.data.store || !data.data.schema) {
            addDebugInfo('⚠️ Snapshot con estructura inválida', data.data);
          } else {
            // ✅ IMPORTANTE: Usar store.loadSnapshot en lugar de editor.loadSnapshot
            // para evitar conflictos con el persistenceKey
            store.loadSnapshot(data.data);
            addDebugInfo('✅ Snapshot cargado desde Supabase', {
              storeKeys: Object.keys(data.data.store).length,
              hasSchema: !!data.data.schema
            });
          }
        } catch (snapshotError) {
          addDebugInfo('❌ Error aplicando snapshot', snapshotError);
        }
      } else {
        addDebugInfo('ℹ️ No hay datos para cargar');
      }
      
      hasLoadedData.current = true;
    } catch (error) {
      addDebugInfo('❌ Error inesperado cargando datos', error);
    } finally {
      setLoading(false);
      addDebugInfo('🏁 Proceso de carga completado');
    }
  }, [session.user.id, addDebugInfo, store]);

  // Función para guardar datos
  const saveUserData = useCallback(async (editor) => {
    if (!hasLoadedData.current) {
      addDebugInfo('⏭️ No guardando - datos aún no cargados');
      return;
    }

    if (isFirstLoad.current) {
      addDebugInfo('⏭️ No guardando - aún en primera carga');
      return;
    }

    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      addDebugInfo('⏰ Cancelando guardado previo...');
    }

    saveTimeout.current = setTimeout(async () => {
      try {
        addDebugInfo('💾 Iniciando guardado automático...');
        
        // ✅ Obtener snapshot del store directamente
        const snapshot = store.getSnapshot();
        
        if (!snapshot || !snapshot.store) {
          addDebugInfo('❌ Snapshot inválido - cancelando guardado', snapshot);
          return;
        }

        const shapesCount = Object.keys(snapshot.store).filter(k => k.startsWith('shape:')).length;
        const dataSize = JSON.stringify(snapshot).length;
        
        addDebugInfo('📊 Guardando snapshot', {
          shapesCount,
          dataSize,
          storeKeys: Object.keys(snapshot.store).length
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
          addDebugInfo('✅ Guardado exitoso en Supabase', {
            recordId: data[0]?.id,
            shapesCount,
            dataSize
          });
        }
      } catch (error) {
        addDebugInfo('❌ Error inesperado en guardado', error);
      }
    }, 1000);
  }, [session.user.id, addDebugInfo, store]);

  // Función que se ejecuta cuando el editor está listo
  const handleMount = useCallback(async (editor) => {
    editorRef.current = editor;
    
    addDebugInfo('🚀 Editor montado correctamente', {
      userId: session.user.id,
      storeId: store.id
    });

    // Configurar preferencias iniciales
    try {
      const currentPrefs = editor.user.getUserPreferences();
      addDebugInfo('👤 Preferencias del usuario', currentPrefs);
      
      // Solo aplicar dark mode si no está configurado
      if (currentPrefs.colorScheme === 'system') {
        editor.user.updateUserPreferences({ 
          colorScheme: 'dark' 
        });
        addDebugInfo('🌙 Dark mode aplicado por defecto');
      }
      
      // Activar grid siempre
      editor.updateInstanceState({ 
        isGridMode: true 
      });
      addDebugInfo('📐 Grid activado por defecto');

    } catch (error) {
      addDebugInfo('❌ Error configurando preferencias iniciales', error);
    }

    // ✅ CRÍTICO: Cargar datos ANTES de configurar el listener
    await loadUserData(editor);

    // Configurar listener para cambios DESPUÉS de cargar
    let changeCount = 0;
    const cleanup = store.listen(() => {
      changeCount++;
      addDebugInfo(`🔄 Cambio detectado en store #${changeCount}`);

      // Solo guardar después de la carga inicial
      if (hasLoadedData.current && !isFirstLoad.current) {
        saveUserData(editor);
      }
    }, { source: 'user', scope: 'document' });

    // Habilitar guardado automático después de un delay
    setTimeout(() => {
      isFirstLoad.current = false;
      addDebugInfo('✅ Guardado automático habilitado');
    }, 3000); // Más tiempo para asegurar que todo esté listo

    addDebugInfo('👂 Store listener configurado');

    return () => {
      addDebugInfo('🧹 Limpieza del componente');
      cleanup();
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [loadUserData, saveUserData, session.user.id, addDebugInfo, store]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        store={store}  // ✅ Usar store personalizado
        // ❌ NO usar persistenceKey para evitar conflictos
        onMount={handleMount}
        overrides={uiOverrides}
        inferDarkMode
      />
      
      {/* Botones de test */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        zIndex: 1002
      }}>
        <button 
          onClick={async () => {
            if (!editorRef.current) return;
            const snapshot = store.getSnapshot();
            const shapesCount = Object.keys(snapshot.store || {}).filter(k => k.startsWith('shape:')).length;
            addDebugInfo('🧪 Snapshot actual', {
              hasStore: !!snapshot?.store,
              hasSchema: !!snapshot?.schema,
              shapesCount,
              storeSize: Object.keys(snapshot?.store || {}).length
            });
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          📊 Ver Snapshot
        </button>
        
        <button 
          onClick={async () => {
            try {
              const { data, error } = await supabase
                .from('canvas_states')
                .select('id, user_id, data, updated_at')
                .eq('user_id', session.user.id);
              
              const shapesInDB = data?.[0]?.data?.store ? 
                Object.keys(data[0].data.store).filter(k => k.startsWith('shape:')).length : 0;
                
              addDebugInfo('🗃️ Estado en Supabase', { 
                recordsFound: data?.length || 0,
                shapesInDB,
                lastUpdate: data?.[0]?.updated_at,
                error 
              });
            } catch (err) {
              addDebugInfo('❌ Error consultando Supabase', err);
            }
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          🗃️ Ver DB
        </button>
      </div>

      {/* Panel de Debug compacto */}
      <div style={{
        position: 'absolute',
        top: '40px',
        right: '10px',
        width: '320px',
        maxHeight: '300px',
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        color: 'white',
        padding: '8px',
        borderRadius: '6px',
        fontSize: '11px',
        overflow: 'auto',
        zIndex: 1001,
        fontFamily: 'monospace'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '4px' }}>
          🐛 Debug ({debugInfo.length}) - {loading ? '⏳ Loading' : '✅ Ready'}
        </div>
        {debugInfo.slice(-8).reverse().map((info, index) => (
          <div key={index} style={{ 
            marginBottom: '4px', 
            borderBottom: '1px solid #222',
            paddingBottom: '3px',
            fontSize: '10px'
          }}>
            <div style={{ color: '#4ade80' }}>
              [{info.time}] {info.message}
            </div>
            {info.data && (
              <div style={{ 
                backgroundColor: '#111',
                padding: '3px',
                marginTop: '2px',
                borderRadius: '2px',
                maxHeight: '60px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: '9px',
                color: '#94a3b8'
              }}>
                {info.data.substring(0, 200)}{info.data.length > 200 ? '...' : ''}
              </div>
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
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '18px', marginBottom: '10px' }}>🎨</div>
            <div>Cargando canvas desde Supabase...</div>
          </div>
        </div>
      )}
    </div>
  )
}