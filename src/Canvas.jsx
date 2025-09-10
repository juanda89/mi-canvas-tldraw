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
  const [overlayEvents, setOverlayEvents] = useState([]);
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

  // Ventana flotante: helper para eventos breves (pegado / edge)
  const pushOverlayEvent = useCallback((text) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setOverlayEvents((prev) => {
      const next = [...prev, { id, text, time: new Date().toLocaleTimeString() }];
      return next.slice(-8); // mantener últimos 8
    });
    // Auto remover en 8s
    setTimeout(() => {
      setOverlayEvents((prev) => prev.filter((e) => e.id !== id));
    }, 8000);
  }, []);

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
              data: userData, // ✅ Solo shapes y assepts, NO configuraciones del sistema
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

  // Listener global de paste (solo debug visual, no altera comportamiento)
  useEffect(() => {
    const onPaste = (e) => {
      try {
        const txt = e.clipboardData?.getData('text/uri-list') || e.clipboardData?.getData('text/plain') || '';
        if (txt) {
          const urls = txt.split(/[\n\s]+/).filter(Boolean).filter((u) => {
            try { const uu = new URL(u); return /^https?:$/.test(uu.protocol); } catch { return false; }
          });
          if (urls.length) {
            pushOverlayEvent(`📥 Evento Paste detectado (${urls.length})`);
          } else {
            pushOverlayEvent('📥 Evento Paste (texto)');
          }
        } else {
          pushOverlayEvent('📥 Evento Paste');
        }
      } catch {
        pushOverlayEvent('📥 Evento Paste');
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pushOverlayEvent]);

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
      // Interceptar URLs pegadas/soltadas y llamar Edge Function
      try {
        const originalUrlHandler = editor.externalContentHandlers?.url;
        editor.registerExternalContentHandler('url', async (externalContent) => {
          const pastedUrl = externalContent?.url;
          if (pastedUrl) {
            addDebugInfo('📎 URL detectada en canvas', { url: pastedUrl });
            pushOverlayEvent(`📥 Pegar URL: ${pastedUrl}`);
          }

          // Guardar shapes actuales para detectar el nuevo shape creado por tldraw
          const beforeIds = new Set(editor.getCurrentPageShapes().map((s) => s.id));

          // Mantener el comportamiento por defecto de tldraw primero
          if (typeof originalUrlHandler === 'function') {
            await originalUrlHandler(externalContent);
          }

          let shapeId = null;
          try {
            // Esperar al siguiente frame para asegurar creación
            await new Promise((r) => requestAnimationFrame(() => r()));
            const afterShapes = editor.getCurrentPageShapes();
            const newShapes = afterShapes.filter((s) => !beforeIds.has(s.id));
            const bookmark = newShapes.find((s) => s.type === 'bookmark') || afterShapes.find((s) => s.type === 'bookmark' && s.props?.url === pastedUrl);
            if (bookmark) {
              shapeId = bookmark.id;
            } else {
              // fallback: usar selección actual si coincide
              const sel = editor.getSelectedShapeIds()[0];
              const selShape = sel ? editor.getShape(sel) : null;
              if (selShape?.type === 'bookmark') shapeId = selShape.id;
            }
          } catch (_) {}

          // Invocar Edge Function con los 3 parámetros requeridos
          if (pastedUrl) {
            const platform = (() => {
              try {
                const host = new URL(pastedUrl).hostname.replace(/^www\./, '');
                if (/^(x\.com|twitter\.com|t\.co)$/i.test(host)) return 'twitter';
                if (/^(instagram\.com)$/i.test(host)) return 'instagram';
                if (/^(tiktok\.com)$/i.test(host)) return 'tiktok';
                if (/^(youtube\.com|youtu\.be)$/i.test(host)) return 'youtube';
                if (/^(facebook\.com)$/i.test(host)) return 'facebook';
                if (/^(linkedin\.com)$/i.test(host)) return 'linkedin';
                return host;
              } catch {
                return 'unknown';
              }
            })();

            pushOverlayEvent(`🚀 Llamando Edge: platform=${platform} shapeId=${shapeId ?? 'N/A'}`);
            try {
              const { data, error } = await supabase.functions.invoke('process-social-url', {
                body: { url: pastedUrl, shapeId, platform },
              });
              if (error) {
                addDebugInfo('❌ Edge Function error', error);
                pushOverlayEvent('❌ Edge Function error (ver panel debug)');
              } else {
                addDebugInfo('✅ Edge Function respuesta', data);
                pushOverlayEvent('✅ Edge Function OK');
              }
            } catch (err) {
              addDebugInfo('❌ Edge Function fallo', err);
              pushOverlayEvent('❌ Edge Function fallo (excepción)');
            }
          }
        });
        addDebugInfo('🔗 Handler de URL registrado');
      } catch (e) {
        addDebugInfo('⚠️ No se pudo registrar handler de URL', e);
      }

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

      {/* Debug panel mejorado */}
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

      {/* Ventana flotante infrior-izquierda (debug rápido de paste/edge) */}
      <div style={{
        position: 'absolute',
        left: '10px',
        bottom: '10px',
        width: '360px',
        backgroundColor: 'rgba(0,0,0,0.9)',
        color: 'white',
        padding: '6px 8px',
        borderRadius: '6px',
        fontSize: '11px',
        zIndex: 1100,
        pointerEvents: 'none',
        maxHeight: '180px',
        overflow: 'auto',
        fontFamily: 'monospace',
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#93c5fd' }}>
          📎 Paste / Edge Debug ({overlayEvents.length})
        </div>
        {overlayEvents.map((e) => (
          <div key={e.id} style={{ marginBottom: '2px', color: '#e5e7eb' }}>
            [{e.time}] {e.text}
          </div>
        ))}
      </div>
    </div>
  )
}
