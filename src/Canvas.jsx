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
  const [isReady, setIsReady] = useState(false);
  const [pasteEvents, setPasteEvents] = useState([]); // ✅ NUEVO: Tracking de paste events
  const saveTimeout = useRef(null);
  const editorRef = useRef(null);
  const lastSaveTime = useRef(0); // ✅ NUEVO: Rate limiting
  
  // Store limpio - NO cargar snapshots completos que corrompan el sistema
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

  // ✅ NUEVO: Función para trackear paste events
  const addPasteEvent = useCallback((type, data, success = null) => {
    const pasteEntry = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      type,
      data,
      success,
      timestamp: new Date().toISOString()
    };
    
    setPasteEvents(prev => [...prev.slice(-15), pasteEntry]);
    addDebugInfo(`📋 Paste Event: ${type}`, data);
  }, [addDebugInfo]);

  // ✅ NUEVO: Función para enviar al webhook
  const sendToWebhook = useCallback(async (pasteData) => {
    try {
      addPasteEvent('📤 sending', pasteData);
      
      const response = await fetch('https://n8n-boominbm-u44048.vm.elestio.app/webhook/process-social-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: session.user.id,
          timestamp: new Date().toISOString(),
          paste_data: pasteData
        })
      });

      if (response.ok) {
        const result = await response.json();
        addPasteEvent('✅ webhook success', result, true);
        return result;
      } else {
        addPasteEvent('❌ webhook error', { status: response.status }, false);
        return null;
      }
    } catch (error) {
      addPasteEvent('❌ webhook failed', error.message, false);
      return null;
    }
  }, [session.user.id, addPasteEvent]);

  // ✅ Extraer solo contenido del usuario (shapes y assets)
  const extractUserData = useCallback((snapshot) => {
    const userShapes = {};
    const userAssets = {};
    
    Object.entries(snapshot.store).forEach(([key, value]) => {
      if (key.startsWith('shape:') && value.typeName === 'shape') {
        userShapes[key] = value;
      }
      if (key.startsWith('asset:') && value.typeName === 'asset') {
        userAssets[key] = value;
      }
    });

    return {
      shapes: userShapes,
      assets: userAssets,
      metadata: {
        shapesCount: Object.keys(userShapes).length,
        assetsCount: Object.keys(userAssets).length,
        savedAt: new Date().toISOString()
      }
    };
  }, []);

  // ✅ Cargar solo shapes sin tocar configuraciones del sistema
  const loadUserShapes = useCallback((userData) => {
    if (!userData.shapes || !editorRef.current) return;

    addDebugInfo('📥 Cargando shapes selectivamente...', {
      shapesToLoad: Object.keys(userData.shapes).length,
      assetsToLoad: Object.keys(userData.assets || {}).length
    });

    try {
      const assetsToCreate = Object.values(userData.assets || {});
      if (assetsToCreate.length > 0) {
        editorRef.current.createAssets(assetsToCreate);
        addDebugInfo('✅ Assets cargados', { count: assetsToCreate.length });
      }

      const shapesToCreate = Object.values(userData.shapes);
      if (shapesToCreate.length > 0) {
        editorRef.current.createShapes(shapesToCreate);
        addDebugInfo('✅ Shapes cargados', { count: shapesToCreate.length });
      }
    } catch (error) {
      addDebugInfo('❌ Error cargando shapes', error);
    }
  }, [addDebugInfo]);

  // ✅ OPTIMIZADO: Auto-save sin lag
  useEffect(() => {
    if (!isReady) return;

    addDebugInfo('🔄 Auto-save OPTIMIZADO iniciado');

    let changeCount = 0;
    let significantChanges = 0;

    const cleanup = store.listen((entry) => {
      changeCount++;
      
      // Solo contar cambios significativos
      const hasShapeChanges = entry.changes.added.some(record => record.typeName === 'shape') || 
                             entry.changes.updated.some(record => record.typeName === 'shape');

      if (hasShapeChanges) {
        significantChanges++;
        
        // Solo log cada 3 cambios significativos
        if (significantChanges % 3 === 0) {
          addDebugInfo(`💾 ${significantChanges} cambios → guardando en 4s`);
        }
      }

      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }

      // Solo continuar si hay cambios significativos
      if (significantChanges === 0) return;

      saveTimeout.current = setTimeout(async () => {
        const now = Date.now();
        
        // Rate limiting: 8 segundos mínimo entre saves
        if (now - lastSaveTime.current < 8000) {
          addDebugInfo('⏭️ Save bloqueado (rate limit 8s)');
          return;
        }

        try {
          lastSaveTime.current = now;
          
          const snapshot = store.getSnapshot();
          if (!snapshot?.store) return;

          const userData = extractUserData(snapshot);
          
          if (userData.metadata.shapesCount === 0) {
            addDebugInfo('⏭️ Sin shapes para guardar');
            return;
          }

          addDebugInfo('💾 Guardando...', { shapes: userData.metadata.shapesCount });

          const { data: updateData, error: updateError } = await supabase
            .from('canvas_states')
            .update({ 
              data: userData,
              updated_at: new Date().toISOString() 
            })
            .eq('user_id', session.user.id)
            .select();

          if (updateError) {
            addDebugInfo('❌ Update error', updateError);
            return;
          }

          if (updateData && updateData.length > 0) {
            addDebugInfo('✅ Guardado OK', { shapes: userData.metadata.shapesCount });
            changeCount = 0;
            significantChanges = 0;
          } else {
            const { data: insertData, error: insertError } = await supabase
              .from('canvas_states')
              .insert({ 
                user_id: session.user.id, 
                data: userData,
                updated_at: new Date().toISOString() 
              })
              .select();

            if (!insertError) {
              addDebugInfo('✅ Usuario nuevo creado');
              changeCount = 0;
              significantChanges = 0;
            }
          }
        } catch (error) {
          addDebugInfo('❌ Auto-save error', error);
        }
      }, 4000); // 4 segundos delay

    }, { source: 'user', scope: 'document' });

    return () => {
      addDebugInfo('🧹 Auto-save cleanup');
      cleanup();
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [isReady, store, session.user.id, addDebugInfo, extractUserData]);

  // ✅ NUEVO: Paste event listener
  useEffect(() => {
    if (!isReady || !editorRef.current) return;

    addDebugInfo('📋 Paste listener iniciado');

    let pasteTimeout = null;

    const cleanup = store.listen((entry) => {
      const pasteShapes = entry.changes.added.filter(record => {
        if (record.typeName !== 'shape') return false;
        
        // URLs
        if (record.type === 'bookmark' && record.props?.url) return true;
        
        // Texto largo (probable paste)
        if (record.type === 'text' && record.props?.text && record.props.text.length > 20) return true;
        
        // Imágenes
        if (record.type === 'image') return true;
        
        return false;
      });

      if (pasteShapes.length > 0) {
        addPasteEvent('🔍 paste detected', { count: pasteShapes.length });

        if (pasteTimeout) clearTimeout(pasteTimeout);
        
        pasteTimeout = setTimeout(async () => {
          for (const shape of pasteShapes) {
            const pasteData = {
              type: 'shape',
              shapeType: shape.type,
              id: shape.id,
              timestamp: new Date().toISOString()
            };

            if (shape.type === 'bookmark' && shape.props?.url) {
              pasteData.url = shape.props.url;
              pasteData.isURL = true;
              addPasteEvent('🔗 URL pasted', { url: shape.props.url });
              await sendToWebhook(pasteData);
              
            } else if (shape.type === 'text' && shape.props?.text) {
              pasteData.text = shape.props.text.substring(0, 50);
              pasteData.isText = true;
              addPasteEvent('📝 text pasted', { length: shape.props.text.length });
              await sendToWebhook(pasteData);
              
            } else if (shape.type === 'image') {
              pasteData.isImage = true;
              addPasteEvent('🖼️ image pasted', { id: shape.id });
              await sendToWebhook(pasteData);
            }
          }
        }, 500); // 500ms debounce
      }
    }, { source: 'user', scope: 'document' });

    return () => {
      addDebugInfo('🧹 Paste listener cleanup');
      cleanup();
      if (pasteTimeout) clearTimeout(pasteTimeout);
    };
  }, [isReady, store, addPasteEvent, sendToWebhook, addDebugInfo]);

  // Función de carga
  const loadUserData = useCallback(async () => {
    try {
      addDebugInfo('📥 Cargando desde Supabase...');
      
      const { data, error } = await supabase
        .from('canvas_states')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      if (error?.code === 'PGRST116') {
        addDebugInfo('ℹ️ Usuario nuevo');
        return null;
      }

      if (error) {
        addDebugInfo('❌ Error carga', error);
        return null;
      }

      if (data?.data) {
        addDebugInfo('📊 Datos encontrados', {
          shapes: Object.keys(data.data.shapes || {}).length,
          assets: Object.keys(data.data.assets || {}).length
        });
        return data.data;
      }

      return null;
    } catch (error) {
      addDebugInfo('❌ Error inesperado', error);
      return null;
    }
  }, [session.user.id, addDebugInfo]);

  // onMount
  const handleMount = useCallback(async (editor) => {
    editorRef.current = editor;
    addDebugInfo('🚀 Editor montado');

    try {
      const userData = await loadUserData();
      if (userData) {
        loadUserShapes(userData);
        addDebugInfo('✅ Contenido cargado');
      }

      const prefs = editor.user.getUserPreferences();
      if (prefs.colorScheme === 'system') {
        editor.user.updateUserPreferences({ colorScheme: 'dark' });
        addDebugInfo('🌙 Dark mode');
      }
      
      editor.updateInstanceState({ isGridMode: true });
      addDebugInfo('📐 Grid activado');

      setLoading(false);
      addDebugInfo('✅ Carga completada');

      setTimeout(() => {
        setIsReady(true);
        addDebugInfo('🟢 Sistema LISTO');
      }, 2000);

    } catch (error) {
      addDebugInfo('❌ Error mount', error);
      setLoading(false);
    }
  }, [loadUserData, loadUserShapes, addDebugInfo]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        store={store}
        onMount={handleMount}
        overrides={uiOverrides}
        inferDarkMode
      />
      
      {/* Botones de control */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        zIndex: 1003
      }}>
        <button 
          onClick={() => {
            addDebugInfo('🧪 Estado', { loading, isReady, storeId: store.id });
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          🧪 Estado
        </button>

        <button 
          onClick={() => {
            if (editorRef.current) {
              const camera = editorRef.current.getCamera();
              const shapes = editorRef.current.getCurrentPageShapes();
              
              addDebugInfo('🔍 Test funciones', {
                camera: { x: camera.x, y: camera.y, z: camera.z, isLocked: camera.isLocked },
                shapeCount: shapes.length
              });
            }
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px', backgroundColor: '#3b82f6' }}
        >
          🔍 Funciones
        </button>
        
        <button 
          onClick={() => {
            setIsReady(prev => {
              const newState = !prev;
              addDebugInfo(`🔄 Auto-save ${newState ? 'ON' : 'OFF'}`);
              return newState;
            });
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px', backgroundColor: isReady ? '#22c55e' : '#ef4444' }}
        >
          {isReady ? '🟢' : '🔴'} AutoSave
        </button>

        <button 
          onClick={async () => {
            const testData = {
              type: 'manual_test',
              message: 'Test webhook manual',
              timestamp: new Date().toISOString()
            };
            
            await sendToWebhook(testData);
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px', backgroundColor: '#f59e0b' }}
        >
          📤 Test Hook
        </button>

        <button 
          onClick={async () => {
            try {
              const { data } = await supabase
                .from('canvas_states')
                .select('id, user_id, updated_at, data')
                .eq('user_id', session.user.id);
              
              const savedData = data?.[0]?.data;
              addDebugInfo('🗃️ DB Estado', { 
                records: data?.length || 0,
                shapes: Object.keys(savedData?.shapes || {}).length,
                lastUpdate: data?.[0]?.updated_at
              });
            } catch (err) {
              addDebugInfo('❌ DB Error', err);
            }
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          🗃️ DB
        </button>
      </div>

      {/* ✅ NUEVA: Ventana de Paste Events (AZUL) */}
      <div style={{
        position: 'absolute',
        top: '50px',
        left: '10px',
        width: '300px',
        maxHeight: '250px',
        backgroundColor: 'rgba(59, 130, 246, 0.95)',
        color: 'white',
        padding: '10px',
        borderRadius: '8px',
        fontSize: '11px',
        overflow: 'auto',
        zIndex: 1002,
        fontFamily: 'monospace',
        border: '2px solid #3b82f6'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '12px' }}>
          📋 PASTE EVENTS & WEBHOOK MONITOR
        </div>
        <div style={{ 
          marginBottom: '10px', 
          fontSize: '10px', 
          color: '#dbeafe',
          borderBottom: '1px solid rgba(255,255,255,0.3)',
          paddingBottom: '5px'
        }}>
          🔗 Endpoint: {isReady ? '🟢 ACTIVO' : '🔴 INACTIVO'} | n8n-webhook
        </div>
        
        {pasteEvents.length === 0 ? (
          <div style={{ 
            fontSize: '11px', 
            color: '#bfdbfe', 
            fontStyle: 'italic',
            textAlign: 'center',
            padding: '20px'
          }}>
            💡 Pega una URL o texto largo para ver eventos aquí
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '10px', marginBottom: '8px', color: '#dbeafe' }}>
              Total eventos: {pasteEvents.length}
            </div>
            {pasteEvents.slice(-6).reverse().map((event) => (
              <div key={event.id} style={{ 
                marginBottom: '8px', 
                borderLeft: `3px solid ${event.success === true ? '#10b981' : event.success === false ? '#ef4444' : '#fbbf24'}`,
                paddingLeft: '8px',
                fontSize: '10px'
              }}>
                <div style={{ 
                  color: event.success === true ? '#86efac' : event.success === false ? '#fca5a5' : '#fef3c7',
                  fontWeight: 'bold'
                }}>
                  [{event.time}] {event.type}
                </div>
                {event.data && (
                  <div style={{ 
                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                    padding: '4px',
                    marginTop: '3px',
                    borderRadius: '3px',
                    fontSize: '9px',
                    color: '#dbeafe',
                    wordBreak: 'break-all'
                  }}>
                    {typeof event.data === 'string' ? 
                      event.data.substring(0, 60) : 
                      JSON.stringify(event.data).substring(0, 60)
                    }...
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Debug panel (NEGRO) */}
      <div style={{
        position: 'absolute',
        top: '50px',
        right: '10px',
        width: '320px',
        maxHeight: '280px',
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
          🐛 DEBUG ({debugInfo.length}) - {loading ? '⏳ Loading' : '✅ Ready'}
        </div>
        <div style={{ 
          marginBottom: '8px', 
          fontSize: '10px', 
          color: isReady ? '#22c55e' : '#ef4444',
          fontWeight: 'bold'
        }}>
          AutoSave: {isReady ? '🟢 OPTIMIZADO (4s delay, 8s limit)' : '🔴 OFF'}
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
                fontSize: '9px',
                color: '#94a3b8',
                maxHeight: '40px',
                overflow: 'hidden'
              }}>
                {info.data.substring(0, 80)}...
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
            <div>Cargando canvas optimizado...</div>
          </div>
        </div>
      )}
    </div>
  )
}