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
  
  // Crear store limpio
  const [store] = useState(() => {
    const cleanStore = createTLStore();
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
    setDebugInfo(prev => [...prev.slice(-20), debugEntry]);
  }, []);

  // ✅ FIX: Guardar usando UPDATE/INSERT en lugar de upsert problemático
  const saveUserData = useCallback(async (editor) => {
    if (!hasLoadedData.current || isFirstLoad.current) {
      addDebugInfo('⏭️ No guardando - condiciones no cumplidas', {
        hasLoadedData: hasLoadedData.current,
        isFirstLoad: isFirstLoad.current,
        loading
      });
      return;
    }

    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }

    saveTimeout.current = setTimeout(async () => {
      try {
        addDebugInfo('💾 Iniciando guardado...');
        
        const snapshot = store.getSnapshot();
        
        if (!snapshot || !snapshot.store) {
          addDebugInfo('❌ Snapshot inválido', snapshot);
          return;
        }

        const shapesCount = Object.keys(snapshot.store).filter(k => k.startsWith('shape:')).length;
        const dataSize = JSON.stringify(snapshot).length;
        
        addDebugInfo('📊 Preparando guardado', { shapesCount, dataSize });

        // ✅ SOLUCIÓN: Primero intentar UPDATE, si falla hacer INSERT
        const { error: updateError } = await supabase
          .from('canvas_states')
          .update({ 
            data: snapshot, 
            updated_at: new Date().toISOString() 
          })
          .eq('user_id', session.user.id);

        if (updateError) {
          addDebugInfo('ℹ️ Update falló, intentando insert...', updateError);
          
          // Si UPDATE falla (no existe), hacer INSERT
          const { data, error: insertError } = await supabase
            .from('canvas_states')
            .insert({ 
              user_id: session.user.id, 
              data: snapshot, 
              updated_at: new Date().toISOString() 
            })
            .select();

          if (insertError) {
            addDebugInfo('❌ Error en INSERT', insertError);
          } else {
            addDebugInfo('✅ Datos insertados exitosamente', {
              recordId: data[0]?.id,
              shapesCount
            });
          }
        } else {
          addDebugInfo('✅ Datos actualizados exitosamente', { shapesCount });
        }

      } catch (error) {
        addDebugInfo('❌ Error inesperado guardando', error);
      }
    }, 1000);
  }, [session.user.id, addDebugInfo, store, loading]);

  // ✅ FIX: Asegurar que setLoading(false) SIEMPRE se ejecute
  const loadUserData = useCallback(async (editor) => {
    if (hasLoadedData.current) {
      addDebugInfo('⏭️ Datos ya cargados');
      setLoading(false); // ✅ Asegurar que se ponga en false
      return;
    }
    
    try {
      addDebugInfo('📥 Cargando datos de Supabase...');
      
      const { data, error } = await supabase
        .from('canvas_states')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          addDebugInfo('ℹ️ Usuario nuevo - sin datos previos');
        } else {
          addDebugInfo('❌ Error cargando', error);
        }
      } else if (data && data.data) {
        addDebugInfo('📊 Datos encontrados', {
          recordId: data.id,
          shapesCount: Object.keys(data.data.store || {}).filter(k => k.startsWith('shape:')).length,
          dataSize: JSON.stringify(data.data).length
        });

        try {
          if (data.data.store && data.data.schema) {
            store.loadSnapshot(data.data);
            addDebugInfo('✅ Snapshot cargado correctamente');
          } else {
            addDebugInfo('⚠️ Snapshot con estructura inválida');
          }
        } catch (snapshotError) {
          addDebugInfo('❌ Error aplicando snapshot', snapshotError);
        }
      }
      
      hasLoadedData.current = true;
      
    } catch (error) {
      addDebugInfo('❌ Error inesperado', error);
    } finally {
      // ✅ CRÍTICO: SIEMPRE poner loading en false
      setLoading(false);
      addDebugInfo('✅ Loading completado - estado ready');
    }
  }, [session.user.id, addDebugInfo, store]);

  // Función onMount
  const handleMount = useCallback(async (editor) => {
    editorRef.current = editor;
    
    addDebugInfo('🚀 Editor montado', { userId: session.user.id });

    // Configurar preferencias
    try {
      const currentPrefs = editor.user.getUserPreferences();
      
      if (currentPrefs.colorScheme === 'system') {
        editor.user.updateUserPreferences({ colorScheme: 'dark' });
        addDebugInfo('🌙 Dark mode aplicado');
      }
      
      editor.updateInstanceState({ isGridMode: true });
      addDebugInfo('📐 Grid activado');

    } catch (error) {
      addDebugInfo('❌ Error configurando preferencias', error);
    }

    // ✅ CARGAR datos primero
    await loadUserData(editor);

    // ✅ DESPUÉS configurar listener  
    let changeCount = 0;
    const cleanup = store.listen(() => {
      changeCount++;
      addDebugInfo(`🔄 Cambio #${changeCount}`, {
        loading,
        hasLoadedData: hasLoadedData.current,
        isFirstLoad: isFirstLoad.current
      });

      // Condiciones para guardar
      if (!loading && hasLoadedData.current && !isFirstLoad.current) {
        addDebugInfo('💾 Guardando automáticamente...');
        saveUserData(editor);
      } else {
        addDebugInfo('⏭️ No guardando', {
          loading,
          hasLoadedData: hasLoadedData.current,
          isFirstLoad: isFirstLoad.current
        });
      }
    }, { source: 'user', scope: 'document' });

    // ✅ Habilitar guardado después de delay
    setTimeout(() => {
      isFirstLoad.current = false;
      addDebugInfo('✅ Guardado automático habilitado');
    }, 2000);

    addDebugInfo('👂 Store listener configurado');

    return () => {
      addDebugInfo('🧹 Cleanup');
      cleanup();
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [loadUserData, saveUserData, session.user.id, addDebugInfo, store, loading]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        store={store}
        onMount={handleMount}
        overrides={uiOverrides}
        inferDarkMode
      />
      
      {/* Test buttons */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        zIndex: 1002
      }}>
        <button 
          onClick={() => {
            addDebugInfo('🧪 Estado actual', {
              loading,
              hasLoadedData: hasLoadedData.current,
              isFirstLoad: isFirstLoad.current,
              changesDetected: 'check console'
            });
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          🧪 Estado
        </button>
        
        <button 
          onClick={async () => {
            if (editorRef.current) {
              await saveUserData(editorRef.current);
              addDebugInfo('🧪 Guardado manual triggereado');
            }
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          💾 Guardar
        </button>

        <button 
          onClick={async () => {
            try {
              const { data, error } = await supabase
                .from('canvas_states')
                .select('id, user_id, data, updated_at')
                .eq('user_id', session.user.id);
              
              addDebugInfo('🗃️ Estado en DB', { 
                recordsFound: data?.length || 0,
                error,
                lastUpdate: data?.[0]?.updated_at
              });
            } catch (err) {
              addDebugInfo('❌ Error consultando DB', err);
            }
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          🗃️ Ver DB
        </button>
      </div>

      {/* Debug panel */}
      <div style={{
        position: 'absolute',
        top: '40px',
        right: '10px',
        width: '320px',
        maxHeight: '350px',
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
          🐛 Debug ({debugInfo.length}) - Status: {loading ? '⏳ Loading' : '✅ Ready'}
        </div>
        <div style={{ marginBottom: '8px', fontSize: '10px', color: '#4ade80' }}>
          Loading: {loading ? 'true' : 'false'} | 
          LoadedData: {hasLoadedData.current ? 'true' : 'false'} | 
          FirstLoad: {isFirstLoad.current ? 'true' : 'false'}
        </div>
        {debugInfo.slice(-10).reverse().map((info, index) => (
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
            <div>Cargando canvas...</div>
          </div>
        </div>
      )}
    </div>
  )
}