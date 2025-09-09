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
  
  // Store limpio - MANTENER sin cargar snapshots completos
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

  // ✅ NUEVO: Extraer solo shapes y datos seguros del snapshot
  const extractUserData = (snapshot) => {
    const userShapes = {};
    const userAssets = {};
    
    // Solo extraer shapes (dibujos del usuario)
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
  };

  // ✅ NUEVO: Cargar solo shapes sin tocar configuraciones del sistema
  const loadUserShapes = (userData) => {
    if (!userData.shapes) return;

    addDebugInfo('📥 Cargando shapes selectivamente...', {
      shapesToLoad: Object.keys(userData.shapes).length,
      assetsToLoad: Object.keys(userData.assets || {}).length
    });

    // Crear shapes una por una (sin loadSnapshot completo)
    const shapesToCreate = Object.values(userData.shapes);
    const assetsToCreate = Object.values(userData.assets || {});

    try {
      // Crear assets primero
      if (assetsToCreate.length > 0) {
        editorRef.current.createAssets(assetsToCreate);
        addDebugInfo('✅ Assets cargados', { count: assetsToCreate.length });
      }

      // Crear shapes
      if (shapesToCreate.length > 0) {
        editorRef.current.createShapes(shapesToCreate);
        addDebugInfo('✅ Shapes cargados', { count: shapesToCreate.length });
      }

    } catch (error) {
      addDebugInfo('❌ Error cargando shapes', error);
    }
  };

  // ✅ APPROACH NUEVO: useEffect separado para guardado automático
  useEffect(() => {
    if (!isReady) {
      addDebugInfo('⏭️ AutoSave: No ready yet');
      return;
    }

    addDebugInfo('🔄 Configurando auto-save selectivo...');

    let changeCount = 0;
    const cleanup = store.listen(() => {
      changeCount++;
      addDebugInfo(`🔄 Store cambio #${changeCount} - AutoSave activo`);

      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }

      saveTimeout.current = setTimeout(async () => {
        try {
          addDebugInfo('💾 Auto-guardando (selectivo)...');
          
          const snapshot = store.getSnapshot();
          if (!snapshot?.store) {
            addDebugInfo('❌ Snapshot inválido');
            return;
          }

          // ✅ EXTRAER SOLO DATOS DEL USUARIO (no configuraciones del sistema)
          const userData = extractUserData(snapshot);
          
          addDebugInfo('📊 Datos extraídos', userData.metadata);

          // Verificar si el usuario existe
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
            // Usuario existe → UPDATE solo con datos del usuario
            const { data: updateData, error: updateError } = await supabase
              .from('canvas_states')
              .update({ 
                data: userData, // ✅ Solo shapes y assets, no configuraciones del sistema
                updated_at: new Date().toISOString() 
              })
              .eq('user_id', session.user.id)
              .select();

            if (updateError) {
              addDebugInfo('❌ Error en UPDATE', updateError);
            } else {
              addDebugInfo('✅ UPDATE exitoso (selectivo)', { 
                recordId: updateData[0]?.id,
                shapesCount: userData.metadata.shapesCount
              });
            }
          } else {
            // Usuario nuevo → INSERT
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
              addDebugInfo('✅ INSERT exitoso - Usuario creado (selectivo)', { 
                recordId: insertData[0]?.id,
                shapesCount: userData.metadata.shapesCount
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
  }, [isReady, store, session.user.id, addDebugInfo]);

  // ✅ NUEVO: Listener para detectar URLs pegadas
  useEffect(() => {
    if (!isReady || !editorRef.current) return;

    addDebugInfo('🔗 Configurando listener de URLs...');

    const cleanup = store.listen((changes) => {
      changes.added.forEach(record => {
        if (record.typeName === 'shape' && record.type === 'bookmark') {
          handleURLDetected(record);
        }
      });
    }, { source: 'user', scope: 'document' });

    return () => {
      addDebugInfo('🧹 URL listener cleanup');
      cleanup();
    };
  }, [isReady, store]);

  // Función para verificar y procesar URLs
  const handleURLDetected = async (shape) => {
    const url = shape.props.url;
    
    const isInstagram = url.includes('instagram.com') || url.includes('instagr.am');
    const isTiktok = url.includes('tiktok.com') || url.includes('vm.tiktok.com');
    
    if (isInstagram || isTiktok) {
      addDebugInfo('🔗 URL detectada', { 
        url, 
        shapeId: shape.id, 
        platform: isInstagram ? 'instagram' : 'tiktok' 
      });
      
      try {
        addDebugInfo('📤 Enviando a edge function...');

        const { data, error } = await supabase.functions.invoke('process-social-url', {
          body: {
            url: url,
            shapeId: shape.id,
            platform: isInstagram ? 'instagram' : 'tiktok'
          }
        });

        if (error) {
          addDebugInfo('❌ Error en edge function', error);
          return;
        }

        addDebugInfo('✅ Edge function exitosa', data);
        
        if (data.thumbnail) {
          editorRef.current.updateShape({
            id: shape.id,
            props: {
              image: data.thumbnail,
              title: data.title || shape.props.title
            }
          });
          
          addDebugInfo('✅ Thumbnail actualizado', { shapeId: shape.id });
        }

      } catch (error) {
        addDebugInfo('❌ Error procesando URL', error);
      }
    } else {
      addDebugInfo('ℹ️ URL no es Instagram/TikTok', { url });
    }
  };

  // Función de carga simplificada - SOLO shapes
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
        addDebugInfo('📊 Datos encontrados (selectivos)', {
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

  // onMount SIMPLIFICADO - carga selectiva
  const handleMount = useCallback(async (editor) => {
    editorRef.current = editor;
    addDebugInfo('🚀 Editor montado');

    try {
      // Configurar preferencias (DESPUÉS de cargar datos)
      const prefs = editor.user.getUserPreferences();
      if (prefs.colorScheme === 'system') {
        editor.user.updateUserPreferences({ colorScheme: 'dark' });
        addDebugInfo('🌙 Dark mode activado');
      }

      // ✅ CARGAR SOLO SHAPES (sin tocar configuraciones del sistema)
      const userData = await loadUserData();
      if (userData) {
        loadUserShapes(userData); // ✅ Carga selectiva
        addDebugInfo('✅ Shapes cargados selectivamente');
      }

      // Activar grid DESPUÉS (no se sobrescribe porque no cargamos snapshot completo)
      editor.updateInstanceState({ isGridMode: true });
      addDebugInfo('📐 Grid activado (sistema intacto)');

      setLoading(false);
      addDebugInfo('✅ Carga completada - sistema funcional');

      // Habilitar auto-save
      setTimeout(() => {
        setIsReady(true);
        addDebugInfo('🟢 Auto-save HABILITADO (selectivo)');
      }, 2000);

    } catch (error) {
      addDebugInfo('❌ Error en mount', error);
      setLoading(false);
    }
  }, [loadUserData, addDebugInfo]);

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
            // Test de funcionalidad básica
            if (editorRef.current) {
              const camera = editorRef.current.getCamera();
              const canPaste = true; // Esto debería funcionar ahora
              
              addDebugInfo('🔍 Test funcionalidad', {
                camera: {
                  isLocked: camera.isLocked,
                  canPanZoom: !camera.isLocked
                },
                canPaste: canPaste,
                shapeCount: editorRef.current.getCurrentPageShapes().length
              });
            }
          }}
          style={{ margin: '2px', padding: '4px 8px', fontSize: '11px' }}
        >
          🔍 Funciones
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
          AutoSave: {isReady ? '🟢 ENABLED (selectivo)' : '🔴 DISABLED'}
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