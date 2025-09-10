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
  const [scriptButtons, setScriptButtons] = useState({}); // { [shapeId]: { url, tones: string[], platform, pos?: { left, top } } }
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

  // Debug function (persistente y detallada)
  const addDebugInfo = useCallback((message, data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    const normalize = (d) => {
      if (!d) return null;
      if (d instanceof Error) return { name: d.name, message: d.message, stack: d.stack };
      return d;
    };
    const debugEntry = { time: timestamp, message, data: normalize(data) };
    console.log(`🐛 [${timestamp}] ${message}`, data || '');
    setDebugInfo(prev => [...prev, debugEntry]);
  }, []);

  // Tonos disponibles para el generador de guiones
  const TONE_OPTIONS = [
    'Alegre',
    'Divertido',
    'Profesional',
    'Emotivo',
    'Inspirador',
    'Informativo',
    'Irónico',
    'Motivador',
    'Romántico',
    'Dramático',
  ];

  const pickRandomTones = (n = 4) => {
    const arr = [...TONE_OPTIONS];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, n);
  };

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

  // Eliminado: no reposicionar en pan/zoom para evitar lag

  // GIF de loading para bookmark mientras llega el Edge
  const LOADING_THUMB_URL = 'https://res.cloudinary.com/dbo31spki/image/upload/v1757525443/Mad_Hip_Hop_GIF_by_Universal_Music_India_nw52wx.gif';

  // Placeholder inline SVG para loading en el bookmark
  const LOADING_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
      <defs>
        <style>@keyframes s{to{transform:rotate(360deg)}}</style>
      </defs>
      <rect width="100%" height="100%" fill="#0f172a"/>
      <g transform="translate(240,135)">
        <circle r="28" fill="none" stroke="#93c5fd" stroke-width="6" stroke-dasharray="132" stroke-linecap="round" style="transform-origin:center;animation:s 1.1s linear infinite"/>
      </g>
      <text x="50%" y="70%" fill="#e5e7eb" font-size="16" font-family="monospace" text-anchor="middle">Loading thumbnail…</text>
    </svg>`
  );

  // Aplica un thumbnail/metadata al asset del bookmark y ajusta tamaño
  // Nota: No forzamos extensiones. Aceptamos la URL tal cual para evitar 404.
  const normalizeImageUrl = (urlString) => {
    if (!urlString) return '';
    // data URLs o blobs se devuelven tal cual
    if (/^(data:|blob:)/i.test(urlString)) return urlString;
    // Si es una URL válida, regresarla sin modificar
    try { new URL(urlString); return urlString; } catch { /* ignore */ }
    // En caso de strings relativos o no-URL, también los devolvemos tal cual
    return urlString;
  };

  const refreshBookmarkShape = useCallback((editor, shapeId) => {
    const shape = editor.getShape(shapeId);
    if (!shape || shape.type !== 'bookmark') return;
    const assetId = shape.props.assetId;
    editor.run(() => {
      editor.updateShapes([{ id: shapeId, type: 'bookmark', props: { assetId: null } }]);
      editor.updateShapes([{ id: shapeId, type: 'bookmark', props: { assetId } }]);
    });
    // pequeña animación para forzar re-render en el DOM
    editor.updateInstanceState({ isChangingStyle: true });
    editor.timers.setTimeout(() => editor.updateInstanceState({ isChangingStyle: false }), 60);
  }, []);

  const applyBookmarkMetadata = useCallback((editor, shapeId, data, pastedUrl) => {
    const shape = editor.getShape(shapeId);
    if (!shape || shape.type !== 'bookmark') return;
    const assetId = shape.props.assetId;
    if (!assetId) return;
    const asset = editor.getAsset(assetId);
    if (!asset) return;

    const title = data?.title || data?.meta?.title || asset.props.title || '';
    const description = data?.description || data?.meta?.description || asset.props.description || '';
    const favicon = data?.favicon || data?.meta?.favicon || asset.props.favicon || '';
    const rawImage = data?.thumbnail || data?.thumbnailUrl || data?.thumbnail_url || data?.image || data?.image_url || asset.props.image || '';
    const finalImage = normalizeImageUrl(rawImage);

    editor.run(() => {
      editor.updateAssets([
        { ...asset, props: { ...asset.props, title, description, favicon, image: finalImage } }
      ]);
    });
    refreshBookmarkShape(editor, shapeId);

    // Ajustar tamaño segun ratio (si lo sabemos)
    const fitToImage = (naturalW, naturalH) => {
      if (!naturalW || !naturalH) return;
      const current = editor.getShape(shapeId);
      const targetW = current?.props?.w || 300;
      const imageH = Math.max(60, Math.round((targetW * naturalH) / naturalW));
      const extra = title || description ? 100 : 60; // espacio para texto
      const targetH = imageH + extra;
      editor.updateShapes([
        { id: shapeId, type: 'bookmark', props: { w: targetW, h: targetH } }
      ]);
      addDebugInfo('🖼️ Ajustado bookmark al ratio', { targetW, targetH, naturalW, naturalH });
    };

    const imgW = Number(data?.width || data?.w) || null;
    const imgH = Number(data?.height || data?.h) || null;
    if (imgW && imgH) {
      fitToImage(imgW, imgH);
    } else if (finalImage) {
      try {
        const img = new Image();
        img.onload = () => {
          addDebugInfo('🖼️ Imagen cargada para ajuste', { w: img.naturalWidth, h: img.naturalHeight, src: finalImage });
          fitToImage(img.naturalWidth, img.naturalHeight);
        };
        img.onerror = (e) => {
          addDebugInfo('⚠️ Error cargando imagen (no ajusta tamaño)', { src: finalImage, error: e?.message || String(e) });
        };
        img.src = finalImage;
      } catch {/* ignore */}
    }
  }, [addDebugInfo, refreshBookmarkShape]);

  // Coloca un placeholder de carga si el asset no tiene imagen aún
  const setBookmarkLoading = useCallback((editor, shapeId) => {
    const shape = editor.getShape(shapeId);
    if (!shape || shape.type !== 'bookmark') return;
    const assetId = shape.props.assetId;
    if (!assetId) return;
    const asset = editor.getAsset(assetId);
    if (!asset) return;
    // Forzar GIF de Cloudinary como placeholder de loading
    editor.updateAssets([
      { ...asset, props: { ...asset.props, image: LOADING_THUMB_URL, title: asset.props.title || '', description: asset.props.description || '' } }
    ]);
    // Altura de carga por defecto
    const current = editor.getShape(shapeId);
    const targetW = current?.props?.w || 300;
    const targetH = 180 + 80;
    editor.updateShapes([{ id: shapeId, type: 'bookmark', props: { w: targetW, h: targetH } }]);
  }, [LOADING_THUMB_URL]);

  // Script Action - invoca Edge Function externa (con Authorization del usuario)
  const callScriptAction = useCallback(async (shapeId, tone) => {
    try {
      const editor = editorRef.current;
      if (!editor) return;
      const shape = editor.getShape(shapeId);
      if (!shape || shape.type !== 'bookmark') return;
      const url = shape.props?.url || scriptButtons[shapeId]?.url;
      if (!url) {
        pushOverlayEvent('⚠️ No hay URL para este bookmark');
        return;
      }
      pushOverlayEvent(`📤 Script "${tone}" → Edge`);
      const { data, error } = await supabase.functions.invoke('script-action', {
        body: { url, script: tone },
      });
      if (error) {
        addDebugInfo('❌ script-action error', error);
        pushOverlayEvent('❌ script-action falló');
        return;
      }
      addDebugInfo('✅ script-action OK', data);
      pushOverlayEvent('✅ Script solicitado');
    } catch (e) {
      addDebugInfo('❌ script-action excepción', e);
      pushOverlayEvent('❌ script-action excepción');
    }
  }, [scriptButtons, pushOverlayEvent, addDebugInfo]);

  // Utilidades de espera para robustecer la detección del shape/asset
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const waitForBookmarkShape = useCallback(async (editor, pastedUrl, beforeIds, attempts = 20, interval = 50) => {
    for (let i = 0; i < attempts; i++) {
      const shapes = editor.getCurrentPageShapes();
      const candidates = shapes.filter((s) => s.type === 'bookmark' && s.props?.url === pastedUrl);
      // prioriza shapes nuevos si tenemos beforeIds
      const newOnes = beforeIds ? candidates.filter((s) => !beforeIds.has(s.id)) : candidates;
      const chosen = newOnes[0] || candidates[0];
      if (chosen) return chosen.id;
      await delay(interval);
    }
    return null;
  }, []);

  const waitForAssetOnShape = useCallback(async (editor, shapeId, attempts = 40, interval = 50) => {
    for (let i = 0; i < attempts; i++) {
      const shape = editor.getShape(shapeId);
      const assetId = shape?.props?.assetId;
      const asset = assetId ? editor.getAsset(assetId) : null;
      if (assetId && asset) return { assetId, asset };
      await delay(interval);
    }
    return null;
  }, []);

  // -------------------
  // Inspector manual de shapes
  // -------------------
  const [inspector, setInspector] = useState({
    open: false,
    shapeId: null,
    type: null,
    url: '',
    assetId: null,
    asset: { title: '', description: '', image: '', favicon: '' },
  });
  const [isEditingInspector, setIsEditingInspector] = useState(false);
  const edgeDataRef = useRef({});
  const [edgeDataVersion, setEdgeDataVersion] = useState(0);

  // Track selección actual periódicamente
  useEffect(() => {
    const t = setInterval(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const id = editor.getOnlySelectedShapeId();
      if (!id) {
        if (inspector.open) setInspector((p) => ({ ...p, open: false, shapeId: null }));
        return;
      }
      const shape = editor.getShape(id);
      if (!shape) return;
      if (shape.type === 'bookmark') {
        const assetId = shape.props.assetId;
        const asset = assetId ? editor.getAsset(assetId) : null;
        const next = {
          open: true,
          shapeId: id,
          type: shape.type,
          url: shape.props.url || '',
          assetId: assetId || null,
          asset: {
            title: asset?.props?.title || '',
            description: asset?.props?.description || '',
            image: asset?.props?.image || '',
            favicon: asset?.props?.favicon || '',
          },
        };
        if (!isEditingInspector) {
          setInspector((p) => (JSON.stringify(p) !== JSON.stringify(next) ? next : p));
        }
      } else {
        if (!isEditingInspector) {
          setInspector({ open: true, shapeId: id, type: shape.type, url: '', assetId: null, asset: { title: '', description: '', image: '', favicon: '' } });
        }
      }
    }, 250);
    return () => clearInterval(t);
  }, [inspector.open, isEditingInspector, edgeDataVersion]);

  const inspectorApplyUrl = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !inspector.shapeId) return;
    const shape = editor.getShape(inspector.shapeId);
    if (!shape || shape.type !== 'bookmark') return;
    editor.run(() => {
      editor.updateShapes([{ id: shape.id, type: 'bookmark', props: { url: inspector.url } }]);
    });
    pushOverlayEvent('🔗 URL aplicada al bookmark');
  }, [inspector.shapeId, inspector.url, pushOverlayEvent]);

  const inspectorApplyAsset = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !inspector.shapeId) return;
    const shape = editor.getShape(inspector.shapeId);
    if (!shape || shape.type !== 'bookmark') return;
    // asegurar asset
    let assetId = shape.props.assetId;
    let asset = assetId ? editor.getAsset(assetId) : null;
    if (!asset) {
      // crear asset a partir de la url actual
      const url = inspector.url || shape.props.url || '';
      try {
        const created = await editor.getAssetForExternalContent({ type: 'url', url });
        if (created) {
          editor.run(() => {
            editor.createAssets([created]);
            editor.updateShapes([{ id: shape.id, type: 'bookmark', props: { assetId: created.id } }]);
          });
          assetId = created.id;
          asset = created;
        }
      } catch (e) {
        addDebugInfo('❌ No se pudo crear asset desde URL', e);
      }
    }
    if (!assetId) return;
    // resolver imagen (prueba directa y con proxy)
    const finalImage = normalizeImageUrl(inspector.asset.image || '');

    // actualizar props del asset
    const updated = {
      ...editor.getAsset(assetId),
      props: {
        ...editor.getAsset(assetId)?.props,
        title: inspector.asset.title,
        description: inspector.asset.description,
        image: finalImage,
        favicon: inspector.asset.favicon,
      }
    };
    editor.run(() => {
      editor.updateAssets([updated]);
    });
    refreshBookmarkShape(editor, shape.id);
    pushOverlayEvent('🖼️ Asset actualizado');
  }, [inspector, addDebugInfo, pushOverlayEvent]);

  const inspectorFitHeight = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !inspector.shapeId) return;
    const shape = editor.getShape(inspector.shapeId);
    if (!shape || shape.type !== 'bookmark') return;
    const imgUrl = inspector.asset.image;
    if (!imgUrl) return;
    try {
      const dim = await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => resolve(null);
        im.src = imgUrl;
      });
      if (!dim) return;
      const targetW = shape.props.w || 300;
      const imageH = Math.max(60, Math.round((targetW * dim.h) / dim.w));
      const extra = (inspector.asset.title || inspector.asset.description) ? 100 : 60;
      const targetH = imageH + extra;
      editor.run(() => {
        editor.updateShapes([{ id: shape.id, type: 'bookmark', props: { w: targetW, h: targetH } }]);
      });
      pushOverlayEvent(`📐 Altura ajustada a ratio (${targetH}px)`);
    } catch (e) {
      addDebugInfo('⚠️ Ajuste de altura falló', e);
    }
  }, [inspector, addDebugInfo, pushOverlayEvent]);

  const inspectorSetLoading = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !inspector.shapeId) return;
    const shape = editor.getShape(inspector.shapeId);
    if (!shape || shape.type !== 'bookmark') return;
    const ok = await waitForAssetOnShape(editor, shape.id, 20, 80);
    if (!ok) return;
    setBookmarkLoading(editor, shape.id);
    pushOverlayEvent('⏳ Placeholder de loading aplicado');
  }, [inspector.shapeId, waitForAssetOnShape, setBookmarkLoading, pushOverlayEvent]);

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
      extensions: {
        scriptButtons: scriptButtons,
      },
      metadata: {
        shapesCount: Object.keys(userShapes).length,
        assetsCount: Object.keys(userAssets).length,
        savedAt: new Date().toISOString()
      }
    };
  }, [scriptButtons]);

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

  // ✅ Guardar cuando cambia la botonera (scriptButtons), aunque no cambie el store
  useEffect(() => {
    if (!isReady) return;
    try {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(async () => {
        try {
          addDebugInfo('💾 Guardando cambios de scriptButtons...');
          const snapshot = store.getSnapshot();
          if (!snapshot?.store) return;
          const userData = extractUserData(snapshot);
          const { data: updateData, error: updateError } = await supabase
            .from('canvas_states')
            .update({ data: userData, updated_at: new Date().toISOString() })
            .eq('user_id', session.user.id)
            .select();
          if (updateError) {
            addDebugInfo('❌ Error guardando scriptButtons (UPDATE)', updateError);
            return;
          }
          if (!updateData || updateData.length === 0) {
            const { error: insertError } = await supabase
              .from('canvas_states')
              .insert({ user_id: session.user.id, data: userData, updated_at: new Date().toISOString() });
            if (insertError) addDebugInfo('❌ Error guardando scriptButtons (INSERT)', insertError);
          } else {
            addDebugInfo('✅ scriptButtons guardados');
          }
        } catch (e) {
          addDebugInfo('❌ Error en persistencia de scriptButtons', e);
        }
      }, 600);
    } catch {/* ignore */}
  }, [isReady, store, session.user.id, extractUserData, addDebugInfo, scriptButtons]);

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

  // ✅ onMout con carga selectiva - NO corrompe sistema
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

          // Buscar el bookmark correspondiente (robusto con reintentos)
          let shapeId = await waitForBookmarkShape(editor, pastedUrl, beforeIds, 30, 60);
          if (!shapeId) {
            // como fallback, usa selección actual si es bookmark
            const sel = editor.getSelectedShapeIds()[0];
            const selShape = sel ? editor.getShape(sel) : null;
            if (selShape?.type === 'bookmark') shapeId = selShape.id;
          }

          // Si localizamos el bookmark, aplicar thumbnail de loading (GIF)
          if (shapeId) {
            try {
              const ok = await waitForAssetOnShape(editor, shapeId, 30, 60);
              if (ok) {
                setBookmarkLoading(editor, shapeId);
                addDebugInfo('⏳ Thumbnail de loading aplicado al bookmark', { shapeId });
              }
            } catch (e) {
              addDebugInfo('⚠️ No se pudo aplicar thumbnail de loading', e);
            }
          } else {
            addDebugInfo('⚠️ No se pudo localizar bookmark para URL', { url: pastedUrl });
          }

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
                // Guardar datos recibidos para usarlos desde el Inspector
                try {
                  if (shapeId) edgeDataRef.current[`shape:${shapeId}`] = data;
                  if (pastedUrl) edgeDataRef.current[`url:${pastedUrl}`] = data;
                  setEdgeDataVersion((v) => v + 1);
                  addDebugInfo('💾 Edge data guardado para inspector', { shapeId, pastedUrl });
                } catch {/* ignore */}
                // Añadir botones de tonos si es Instagram o TikTok
                if (shapeId && (platform === 'instagram' || platform === 'tiktok')) {
                  const tones = pickRandomTones(4);
                  try {
                    const b = editor.getShapePageBounds?.(shapeId);
                    const pageToScreen = (pt) => editor.pageToScreen ? editor.pageToScreen(pt) : pt;
                    const anchor = b ? { x: b.maxX + 12, y: b.minY + 8 } : null;
                    const scr = anchor ? pageToScreen(anchor) : { x: 40, y: 40 };
                    setScriptButtons((prev) => ({
                      ...prev,
                      [shapeId]: { url: pastedUrl, tones, platform, pos: { left: scr.x, top: scr.y } },
                    }));
                    addDebugInfo('🎛️ Botonera de tonos creada', { shapeId, tones, pos: { left: scr.x, top: scr.y } });
                  } catch (e) {
                    const tones2 = tones; // fallback sin posición
                    setScriptButtons((prev) => ({ ...prev, [shapeId]: { url: pastedUrl, tones: tones2, platform } }));
                    addDebugInfo('🎛️ Botonera creada (sin pos)', { shapeId, tones: tones2 });
                  }
                }
                // Aplicar automáticamente metadata del Edge a bookmark
                if (shapeId) {
                  try {
                    await waitForAssetOnShape(editor, shapeId, 40, 60);
                    applyBookmarkMetadata(editor, shapeId, data, pastedUrl);
                  } catch (e) {
                    addDebugInfo('⚠️ No se pudo aplicar metadata automáticamente', e);
                  }
                } else {
                  addDebugInfo('⚠️ Edge OK pero no se ubicó shape para aplicar metadata', { url: pastedUrl });
                }
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
        if (userData.extensions?.scriptButtons) {
          // Restaura botones y calcula posición inicial si falta
          const restored = userData.extensions.scriptButtons;
          const editor = editorRef.current;
          if (editor) {
            const pageToScreen = (pt) => editor.pageToScreen ? editor.pageToScreen(pt) : pt;
            const withPos = Object.fromEntries(Object.entries(restored).map(([sid, meta]) => {
              if (meta?.pos) return [sid, meta];
              const b = editor.getShapePageBounds?.(sid);
              if (!b) return [sid, meta];
              const scr = pageToScreen({ x: b.maxX + 12, y: b.minY + 8 });
              return [sid, { ...meta, pos: { left: scr.x, top: scr.y } }];
            }));
            setScriptButtons(withPos);
            addDebugInfo('🎛️ scriptButtons restaurados', { count: Object.keys(withPos).length });
          } else {
            setScriptButtons(restored);
          }
        }
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

      {/* Botoneras de tonos junto a cada bookmark con datos del Edge */}
      {Object.entries(scriptButtons).map(([sid, meta]) => {
        const tones = meta.tones || [];
        const pos = meta.pos;
        if (!pos) return null;
        return (
          <div
            key={`tones-${sid}`}
            style={{
              position: 'absolute',
              left: pos.left,
              top: pos.top,
              zIndex: 1003,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              pointerEvents: 'auto',
            }}
          >
            {tones.map((tone, idx) => (
              <button
                key={`tone-${sid}-${idx}`}
                onClick={() => callScriptAction(sid, tone)}
                title={`Generar script (${tone})`}
                style={{
                  height: 28,
                  padding: '0 12px',
                  borderRadius: 9999,
                  border: '1px solid rgba(56,127,255,0.50)',
                  background: 'rgba(11,18,32,0.85)',
                  color: '#E5E7EB',
                  fontSize: 12,
                  letterSpacing: 0.2,
                  backdropFilter: 'blur(2px)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                  cursor: 'pointer'
                }}
              >
                {tone}
              </button>
            ))}
          </div>
        );
      })}

      {/* Debug panel persistente */}
      <div style={{
        position: 'absolute',
        top: '40px',
        right: '10px',
        width: '320px',
        maxHeight: '380px',
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        color: 'white',
        padding: '8px',
        borderRadius: '6px',
        fontSize: '11px',
        overflow: 'auto',
        zIndex: 1001,
        fontFamily: 'monospace'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '4px' }}>
          <span>🐛 Debug ({debugInfo.length}) - Status: {loading ? '⏳ Loading' : '✅ Ready'}</span>
          <span style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => navigator.clipboard?.writeText(JSON.stringify(debugInfo, null, 2)).catch(() => {})}
              style={{ pointerEvents: 'auto', fontSize: '10px', padding: '2px 6px', background: '#374151', color: 'white', border: '1px solid #4b5563', borderRadius: '4px' }}
            >Copy</button>
            <button
              onClick={() => setDebugInfo([])}
              style={{ pointerEvents: 'auto', fontSize: '10px', padding: '2px 6px', background: '#ef4444', color: 'white', border: '1px solid #b91c1c', borderRadius: '4px' }}
            >Clear</button>
          </span>
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
        {debugInfo.slice().reverse().map((info, index) => (
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
                maxHeight: '160px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: '9px',
                color: '#94a3b8'
              }}>
                {typeof info.data === 'string' ? info.data : JSON.stringify(info.data, null, 2)}
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

      {/* Ventana flotante inferior-izquierda (debug rápido de paste/edge) */}
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

      {/* Inspector de Shape (manual) */}
      {inspector.open && (
        <div style={{
          position: 'absolute',
          right: '10px',
          bottom: '10px',
          width: '360px',
          backgroundColor: 'rgba(17,24,39,0.96)',
          color: 'white',
          padding: '10px',
          borderRadius: '8px',
          fontSize: '12px',
          zIndex: 1101,
          fontFamily: 'monospace',
          pointerEvents: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>🔧 Inspector</strong>
            <span style={{ opacity: 0.7 }}>id: {inspector.shapeId} • {inspector.type}</span>
          </div>

          {inspector.type === 'bookmark' ? (
            <div>
              <div style={{ marginBottom: 6 }}>
                <div>URL</div>
                <input
                  value={inspector.url}
                  onFocus={() => setIsEditingInspector(true)}
                  onBlur={() => setTimeout(() => setIsEditingInspector(false), 120)}
                  onChange={(e) => setInspector((p) => ({ ...p, url: e.target.value }))}
                  style={{ width: '100%', padding: '6px', borderRadius: 4, background: '#111827', color: '#e5e7eb', border: '1px solid #374151' }}
                />
                <button onClick={inspectorApplyUrl} style={{ marginTop: 6, padding: '4px 8px', background: '#2563eb', border: '1px solid #1d4ed8', borderRadius: 4 }}>Aplicar URL</button>
              </div>

              <div style={{ marginBottom: 6 }}>
                <div>Título</div>
                <input
                  value={inspector.asset.title}
                  onFocus={() => setIsEditingInspector(true)}
                  onBlur={() => setTimeout(() => setIsEditingInspector(false), 120)}
                  onChange={(e) => setInspector((p) => ({ ...p, asset: { ...p.asset, title: e.target.value } }))}
                  style={{ width: '100%', padding: '6px', borderRadius: 4, background: '#111827', color: '#e5e7eb', border: '1px solid #374151' }}
                />
              </div>
              <div style={{ marginBottom: 6 }}>
                <div>Descripción</div>
                <textarea
                  value={inspector.asset.description}
                  onFocus={() => setIsEditingInspector(true)}
                  onBlur={() => setTimeout(() => setIsEditingInspector(false), 120)}
                  onChange={(e) => setInspector((p) => ({ ...p, asset: { ...p.asset, description: e.target.value } }))}
                  rows={3}
                  style={{ width: '100%', padding: '6px', borderRadius: 4, background: '#111827', color: '#e5e7eb', border: '1px solid #374151', resize: 'vertical' }}
                />
              </div>
              <div style={{ marginBottom: 6 }}>
                <div>Thumbnail URL</div>
                <input
                  value={inspector.asset.image}
                  onFocus={() => setIsEditingInspector(true)}
                  onBlur={() => setTimeout(() => setIsEditingInspector(false), 120)}
                  onChange={(e) => setInspector((p) => ({ ...p, asset: { ...p.asset, image: e.target.value } }))}
                  style={{ width: '100%', padding: '6px', borderRadius: 4, background: '#111827', color: '#e5e7eb', border: '1px solid #374151' }}
                />
              </div>
              <div style={{ marginBottom: 6 }}>
                <div>Favicon URL</div>
                <input
                  value={inspector.asset.favicon}
                  onFocus={() => setIsEditingInspector(true)}
                  onBlur={() => setTimeout(() => setIsEditingInspector(false), 120)}
                  onChange={(e) => setInspector((p) => ({ ...p, asset: { ...p.asset, favicon: e.target.value } }))}
                  style={{ width: '100%', padding: '6px', borderRadius: 4, background: '#111827', color: '#e5e7eb', border: '1px solid #374151' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button onClick={inspectorApplyAsset} style={{ padding: '6px 10px', background: '#059669', border: '1px solid #047857', borderRadius: 4 }}>Aplicar Asset</button>
                <button onClick={inspectorFitHeight} style={{ padding: '6px 10px', background: '#6b7280', border: '1px solid #4b5563', borderRadius: 4 }}>Ajustar altura</button>
                <button onClick={inspectorSetLoading} style={{ padding: '6px 10px', background: '#f59e0b', border: '1px solid #d97706', borderRadius: 4 }}>Set Loading</button>
                {(() => {
                  const edgeData = edgeDataRef.current[`shape:${inspector.shapeId}`] || edgeDataRef.current[`url:${inspector.url}`];
                  if (!edgeData) return null;
                  const thumb = edgeData.thumbnail || edgeData.thumbnailUrl || edgeData.thumbnail_url || edgeData.image || edgeData.image_url;
                  const title = edgeData.title || edgeData.meta?.title;
                  const desc = edgeData.description || edgeData.meta?.description;
                  return (
                    <button
                      onClick={() => {
                        setInspector((p) => ({
                          ...p,
                          asset: {
                            ...p.asset,
                            image: thumb || p.asset.image,
                            title: title ?? p.asset.title,
                            description: desc ?? p.asset.description,
                          },
                        }));
                        pushOverlayEvent('⬇️ Cargado desde Edge en el inspector');
                      }}
                      style={{ padding: '6px 10px', background: '#3b82f6', border: '1px solid #2563eb', borderRadius: 4 }}
                    >
                      Cargar desde Edge
                    </button>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.8 }}>Aún no soportado para tipo: {inspector.type}</div>
          )}
        </div>
      )}
    </div>
  )
}
