import { Tldraw, DefaultMainMenu, TldrawUiMenuItem, createTLStore } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { supabase } from './supabaseClient'
import { useState, useRef, useCallback, useEffect } from 'react'

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
  const [isReady, setIsReady] = useState(false); // ✅ NUEVO: Estado simple para saber si puede guardar
  const saveTimeout = useRef(null);
  const editorRef = useRef(null);
  
  // Store limpio
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

  // Debug function
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

  // ✅ APPROACH NUEVO: useEffect separado para guardado automático
  useEffect(() => {
    if (!isReady) {
      addDebugInfo('⏭️ AutoSave: No ready yet');
      return;
    }

    addDebugInfo('🔄 Configurando auto-save listener...');

    let changeCount = 0;
    const cleanup = store.listen(() => {
      changeCount++;
      addDebugInfo(`🔄 Store cambio #${changeCount} - AutoSave activo`);

      // ✅ SIMPLE: Si está ready, guardar
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }

      saveTimeout.current = setTimeout(async () => {
        try {
          addDebugInfo('💾 Auto-guardando...');
          
          const snapshot = store.getSnapshot();
          if (!snapshot?.store) {
            addDebugInfo('❌ Snapshot inválido');
            return;
          }

          const shapesCount = Object.keys(snapshot.store).filter(k => k.startsWith('shape:')).length;
          addDebugInfo('📊 Guardando...', { shapesCount });

          // ✅ PASO 1: Verificar si el usuario ya tiene un registro
          const { data: existingData, error: selectError } = await supabase
            .from('canvas_states')
            .select('id, user_id')
            .eq('user_id', session.user.id)
            .single();

          if (selectError && selectError.code !== 'PGRST116') {
            addDebugInfo('❌ Error verificando usuario existente', selectError);
            return;
          }

          const userExists = !!existingData;
          addDebugInfo(`🔍 Usuario ${userExists ? 'EXISTS' : 'NUEVO'}`, {
            userExists,
            existingRecordId: existingData?.id
          });

          if (userExists) {
            // ✅ PASO 2A: Usuario existe → UPDATE
            const { data: updateData, error: updateError } = await supabase
              .from('canvas_states')
              .update({ 
                data: snapshot, 
                updated_at: new Date().toISOString() 
              })
              .eq('user_id', session.user.id)
              .select();

            if (updateError) {
              addDebugInfo('❌ Error en UPDATE', updateError);
            } else {
              addDebugInfo('✅ UPDATE exitoso', { 
                recordId: updateData[0]?.id,
                shapesCount 
              });
            }
          } else {
            // ✅ PASO 2B: Usuario nuevo → INSERT
            const { data: insertData, error: insertError } = await supabase
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
              addDebugInfo('✅ INSERT exitoso - Usuario creado', { 
                recordId: insertData[0]?.id,
                shapesCount 
              });
            }
          }

        } catch (error) {
          addDebugInfo('❌ Error auto-save', error);
        }
      }, 1000);

    }, { source: 'user', scope: 'document' });

    return () => {
      addDebugInfo('🧹 Auto-save cleanup');
      cleanup();
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [isReady, store, session.user.id, addDebugInfo]); // ✅ Solo depende de isReady

  // Función de carga simplificada
  const loadUserData = useCallback(async () => {
    try {
      addDebugInfo('📥 Cargando desde Supabase...');
      
      const { data, error } = await supabase
        .from('canvas_states')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (error?.code === 'PGRST116') {
        addDebugInfo('ℹ️ Usuario nuevo - sin datos');
        return null;
      }

      if (error) {
        addDebugInfo('❌ Error cargando', error);
        return null;
      }

      if (data?.data) {
        addDebugInfo('📊 Datos encontrados', {
          shapes: Object.keys(data.data.store || {}).filter(k => k.startsWith('shape:')).length
        });
        return data.data;
      }

      return null;
    } catch (error) {
      addDebugInfo('❌ Error inesperado cargando', error);
      return null;
    }
  }, [session.user.id, addDebugInfo]);

  // ✅ onMount SIMPLIFICADO - solo cargar y configurar
  const handleMount = useCallback(async (editor) => {
    editorRef.current = editor;
    addDebugInfo('🚀 Editor montado');

    try {
      // Configurar preferencias
      const prefs = editor.user.getUserPreferences();
      if (prefs.colorScheme === 'system') {
        editor.user.updateUserPreferences({ colorScheme: 'dark' });
        addDebugInfo('🌙 Dark mode activado');
      }

      // Cargar datos PRIMERO
      const userData = await loadUserData();
      if (userData) {
        store.loadSnapshot(userData);
        addDebugInfo('✅ Datos cargados en store');
      }

      // ✅ DESPUÉS activar grid (para que no se sobrescriba)
      editor.updateInstanceState({ isGridMode: true,  canMoveCamera: true, canZoom: true });
      addDebugInfo('📐 Grid activado (después de cargar datos)');

      setLoading(false);
      addDebugInfo('✅ Carga completada');

      // ✅ CRÍTICO: Habilitar auto-save después de un delay
      setTimeout(() => {
        setIsReady(true);
        addDebugInfo('🟢 Auto-save HABILITADO');
      }, 2000); // 2 segundos de delay

    } catch (error) {
      addDebugInfo('❌ Error en mount', error);
      setLoading(false);
    }
  }, [loadUserData, store, addDebugInfo]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        store={store}
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
          onClick={() => {
            addDebugInfo('🧪 Estado actual', {
              loading,
              isReady,
              storeId: store.id
            });
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          🧪 Estado
        </button>
        
        <button 
          onClick={() => {
            setIsReady(prev => {
              const newState = !prev;
              addDebugInfo(`🔄 Auto-save ${newState ? 'ENABLED' : 'DISABLED'}`);
              return newState;
            });
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px', backgroundColor: isReady ? '#22c55e' : '#ef4444' }}
        >
          {isReady ? '🟢' : '🔴'} AutoSave
        </button>

        <button 
          onClick={async () => {
            try {
              const { data } = await supabase
                .from('canvas_states')
                .select('id, user_id, updated_at')
                .eq('user_id', session.user.id);
              
              addDebugInfo('🗃️ Estado DB', { 
                records: data?.length || 0,
                lastUpdate: data?.[0]?.updated_at
              });
            } catch (err) {
              addDebugInfo('❌ Error DB', err);
            }
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          🗃️ DB
        </button>
      </div>

      {/* Debug panel */}
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
          🐛 Debug ({debugInfo.length}) - Status: {loading ? '⏳ Loading' : '✅ Ready'}
        </div>
        <div style={{ 
          marginBottom: '8px', 
          fontSize: '10px', 
          color: isReady ? '#22c55e' : '#ef4444',
          fontWeight: 'bold'
        }}>
          AutoSave: {isReady ? '🟢 ENABLED' : '🔴 DISABLED'}
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
                {info.data.substring(0, 150)}{info.data.length > 150 ? '...' : ''}
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