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
  const saveTimeout = useRef(null);
  const editorRef = useRef(null);
  
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

  // ✅ NUEVO: Función para enviar al webhook
  const sendToWebhook = useCallback(async (pasteData) => {
    try {
      addDebugInfo('📤 Enviando al webhook...', pasteData);
      
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
        addDebugInfo('✅ Webhook exitoso', result);
      } else {
        addDebugInfo('❌ Webhook error', { status: response.status });
      }
    } catch (error) {
      addDebugInfo('❌ Error enviando webhook', error);
    }
  }, [session.user.id, addDebugInfo]);

  // ✅ NUEVO: Extraer solo contenido del usuario (shapes y assets)
  const extractUserData = useCallback((snapshot) => {
    const userShapes = {};
    const userAssets = {};
    
    // Solo extraer shapes (dibujos del usuario) y assets
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

  // ✅ NUEVO: Cargar solo shapes sin tocar configuraciones del sistema
  const loadUserShapes = useCallback((userData) => {
    if (!userData.shapes || !editorRef.current) return;

    addDebugInfo('📥 Cargando shapes selectivamente...', {
      shapesToLoad: Object.keys(userData.shapes).length,
      assetsToLoad: Object.keys(userData.assets || {}).length
    });

    try {
      // Crear assets primero
      const assetsToCreate = Object.values(userData.assets || {});
      if (assetsToCreate.length > 0) {
        editorRef.current.createAssets(assetsToCreate);
        addDebugInfo('✅ Assets cargados', { count: assetsToCreate.length });
      }

      // Crear shapes
      const shapesToCreate = Object.values(userData.shapes);
      if (shapesToCreate.length > 0) {
        editorRef.current.createShapes(shapesToCreate);
        addDebugInfo('✅ Shapes cargados', { count: shapesToCreate.length });
      }

    } catch (error) {
      addDebugInfo('❌ Error cargando shapes', error);
    }
  }, [addDebugInfo]);

  // ✅ Auto-save con persistencia selectiva
  useEffect(() => {
    if (!isReady) {
      addDebugInfo('⏭️ AutoSave: No ready yet');
      return;
    }

    addDebugInfo('🔄 Configurando auto-save selectivo...');

    let changeCount = 0;
    const cleanup = store.listen(() => {
      changeCount++;
      addDebugInfo(`🔄 Store cambio #${changeCount} - AutoSave selectivo activo`);

      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }

      saveTimeout.current = setTimeout(async () => {
        try {
          addDebugInfo('💾 Auto-guardando (solo contenido del usuario)...');
          
          const snapshot = store.getSnapshot();
          if (!snapshot?.store) {
            addDebugInfo('❌ Snapshot inválido');
            return;
          }

          // ✅ EXTRAER SOLO CONTENIDO DEL USUARIO (no configuraciones del sistema)
          const userData = extractUserData(snapshot);
          
          addDebugInfo('📊 Datos selectivos extraídos', userData.metadata);

          // Verificar si UPDATE o INSERT
          const { data: updateData, error: updateError } = await supabase
            .from('canvas_states')
            .update({ 
              data: userData, // ✅ Solo shapes y assets, NO configuraciones del sistema
              updated_at: new Date().toISOString() 
            })
            .eq('user_id', session.user.id)
            .select();

          if (updateError) {
            addDebugInfo('❌ Error en UPDATE', updateError);
            return;
          }

          if (updateData && updateData.length > 0) {
            addDebugInfo('✅ UPDATE exitoso (selectivo)', { 
              recordId: updateData[0].id,
              shapesCount: userData.metadata.shapesCount
            });
          } else {
            // INSERT para usuario nuevo
            const { data: insertData, error: insertError } = await supabase
              .from('canvas_states')
              .insert({ 
                user_id: session.user.id, 
                data: userData,
                updated_at: new Date().toISOString() 
              })
              .select();

            if (insertError) {
              addDebugInfo('❌ Error en INSERT', insertError);
            } else {
              addDebugInfo('✅ INSERT exitoso - Usuario nuevo (selectivo)', { 
                recordId: insertData[0]?.id,
                shapesCount: userData.metadata.shapesCount
              });
            }
          }

        } catch (error) {
          addDebugInfo('❌ Error auto-save selectivo', error);
        }
      }, 1000);

    }, { source: 'user', scope: 'document' });

    return () => {
      addDebugInfo('🧹 Auto-save selectivo cleanup');
      cleanup();
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [isReady, store, session.user.id, addDebugInfo, extractUserData]);

  // ✅ OPTIMIZADO: Listener específico para paste events (con debouncing)
  useEffect(() => {
    if (!isReady || !editorRef.current) return;

    addDebugInfo('📋 Configurando listener optimizado de paste...');

    let pasteTimeout = null;
    const pendingPasteData = [];

    const cleanup = store.listen((entry) => {
      // Solo procesar shapes agregadas que parezcan paste events
      const potentialPasteShapes = entry.changes.added.filter(record => {
        return record.typeName === 'shape' && (
          record.type === 'bookmark' ||  // URLs pegadas
          (record.type === 'text' && record.props?.text?.length > 10) || // Texto largo pegado
          record.type === 'image' // Imágenes pegadas
        );
      });

      if (potentialPasteShapes.length > 0) {
        // Agregar a pending y usar debouncing
        potentialPasteShapes.forEach(record => {
          const pasteInfo = {
            type: 'shape',
            shapeType: record.type,
            id: record.id,
            timestamp: new Date().toISOString()
          };

          // Detectar tipo específico
          if (record.type === 'bookmark' && record.props?.url) {
            pasteInfo.url = record.props.url;
            pasteInfo.isURL = true;
            addDebugInfo('🔗 URL pegada detectada', { url: record.props.url });
          } else if (record.type === 'text' && record.props?.text) {
            pasteInfo.text = record.props.text.substring(0, 100); // Limitar texto
            pasteInfo.isText = true;
            addDebugInfo('📝 Texto pegado detectado');
          } else if (record.type === 'image') {
            pasteInfo.isImage = true;
            addDebugInfo('🖼️ Imagen pegada detectada');
          }

          pendingPasteData.push(pasteInfo);
        });

        // Debouncing: esperar 500ms antes de enviar
        if (pasteTimeout) clearTimeout(pasteTimeout);
        
        pasteTimeout = setTimeout(() => {
          if (pendingPasteData.length > 0) {
            // Enviar batch de paste data
            const batchData = {
              type: 'paste_batch',
              items: [...pendingPasteData],
              count: pendingPasteData.length,
              timestamp: new Date().toISOString()
            };
            
            addDebugInfo('📤 Enviando batch de paste data', { count: pendingPasteData.length });
            sendToWebhook(batchData);
            
            // Limpiar pending
            pendingPasteData.length = 0;
          }
        }, 500);
      }
    }, { source: 'user', scope: 'document' });

    return () => {
      addDebugInfo('🧹 Paste listener optimizado cleanup');
      cleanup();
      if (pasteTimeout) clearTimeout(pasteTimeout);
    };
  }, [isReady, store]); // ✅ Dependencias reducidas

  // Función de carga - solo shapes y assets
  const loadUserData = useCallback(async () => {
    try {
      addDebugInfo('📥 Cargando datos selectivos desde Supabase...');
      
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
        addDebugInfo('📊 Datos selectivos encontrados', {
          shapes: Object.keys(data.data.shapes || {}).length,
          assets: Object.keys(data.data.assets || {}).length,
          metadata: data.data.metadata
        });
        return data.data;
      }

      return null;
    } catch (error) {
      addDebugInfo('❌ Error inesperado cargando', error);
      return null;
    }
  }, [session.user.id, addDebugInfo]);

  // ✅ onMount con carga selectiva - NO corrompe sistema
  const handleMount = useCallback(async (editor) => {
    editorRef.current = editor;
    addDebugInfo('🚀 Editor montado - iniciando carga selectiva');

    try {
      // ✅ PRIMERO: Cargar contenido del usuario (shapes/assets)
      const userData = await loadUserData();
      if (userData) {
        loadUserShapes(userData); // ✅ Carga selectiva sin tocar sistema
        addDebugInfo('✅ Contenido del usuario cargado selectivamente');
      }

      // ✅ DESPUÉS: Configurar preferencias (sin sobrescribir)
      const prefs = editor.user.getUserPreferences();
      if (prefs.colorScheme === 'system') {
        editor.user.updateUserPreferences({ colorScheme: 'dark' });
        addDebugInfo('🌙 Dark mode activado');
      }
      
      // ✅ Activar grid (el sistema está intacto)
      editor.updateInstanceState({ isGridMode: true });
      addDebugInfo('📐 Grid activado - sistema funcional');

      setLoading(false);
      addDebugInfo('✅ Carga completada - funcionalidades preservadas');

      // Habilitar auto-save después de delay
      setTimeout(() => {
        setIsReady(true);
        addDebugInfo('🟢 Auto-save selectivo HABILITADO');
      }, 2000);

    } catch (error) {
      addDebugInfo('❌ Error en mount', error);
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
      
      {/* Botones de test mejorados */}
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
            // ✅ Test de funcionalidades básicas que se estaban perdiendo
            if (editorRef.current) {
              const camera = editorRef.current.getCamera();
              const shapes = editorRef.current.getCurrentPageShapes();
              
              addDebugInfo('🔍 Test funcionalidades básicas', {
                camera: {
                  x: camera.x,
                  y: camera.y,
                  z: camera.z,
                  isLocked: camera.isLocked
                },
                shapeCount: shapes.length,
                canPanZoom: 'Test manualmente pan/zoom con trackpad',
                canPaste: 'Test pegando URL o Ctrl+V'
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
              addDebugInfo(`🔄 Auto-save selectivo ${newState ? 'ENABLED' : 'DISABLED'}`);
              return newState;
            });
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px', backgroundColor: isReady ? '#22c55e' : '#ef4444' }}
        >
          {isReady ? '🟢' : '🔴'} AutoSave
        </button>

        <button 
          onClick={async () => {
            // Test manual del webhook
            const testData = {
              type: 'test',
              message: 'Test manual del webhook',
              timestamp: new Date().toISOString(),
              user_id: session.user.id
            };
            
            await sendToWebhook(testData);
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px', backgroundColor: '#f59e0b' }}
        >
          📤 Test Webhook
        </button>

        <button 
          onClick={async () => {
            try {
              const { data } = await supabase
                .from('canvas_states')
                .select('id, user_id, updated_at, data')
                .eq('user_id', session.user.id);
              
              const savedData = data?.[0]?.data;
              addDebugInfo('🗃️ Estado DB (selectivo)', { 
                records: data?.length || 0,
                shapesInDB: Object.keys(savedData?.shapes || {}).length,
                assetsInDB: Object.keys(savedData?.assets || {}).length,
                lastUpdate: data?.[0]?.updated_at,
                dataStructure: savedData ? Object.keys(savedData) : []
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

      {/* Debug panel mejrado */}
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
          AutoSave: {isReady ? '🟢 ENABLED (selectivo)' : '🔴 DISABLED'}
        </div>
        <div style={{ 
          marginBottom: '8px', 
          fontSize: '9px', 
          color: '#fbbf24',
          fontStyle: 'italic'
        }}>
          💡 Persistencia selectiva: Solo shapes/assets, sistema intacto
        </div>
        <div style={{ 
          marginBottom: '8px', 
          fontSize: '9px', 
          color: '#06b6d4',
          fontStyle: 'italic'
        }}>
          📋 Paste Listener: {isReady ? 'ACTIVO - Detectando paste events' : 'INACTIVO'}
        </div>
        <div style={{ 
          marginBottom: '8px', 
          fontSize: '8px', 
          color: '#94a3b8',
          fontStyle: 'italic',
          wordBreak: 'break-all'
        }}>
          📤 Webhook: n8n-boominbm...webhook/process-social-url
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
            <div>Cargando canvas con persistencia selectiva...</div>
          </div>
        </div>
      )}
    </div>
  )
}