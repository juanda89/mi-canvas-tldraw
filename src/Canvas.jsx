import { Tldraw, DefaultMainMenu, TldrawUiMenuItem, createTLStore } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { supabase } from './supabaseClient'
import { useState, useEffect, useRef } from 'react'

const MyMainMenu = () => {
  const handleSignOut = () => { supabase.auth.signOut() }
  return (
    <DefaultMainMenu>
      <TldrawUiMenuItem id="sign-out" label="Cerrar Sesión" onSelect={handleSignOut} />
    </DefaultMainMenu>
  )
}

const uiOverrides = { mainMenu: MyMainMenu }

export default function Canvas({ session }) {
  const [editor, setEditor] = useState(null)
  const [store] = useState(() => createTLStore())
  const [loading, setLoading] = useState(true)
  const savingTimeout = useRef<NodeJS.Timeout | null>(null)
  const hydratingRef = useRef(false) // 👈 evita guardar mientras cargas

  // --- CARGA (hidratar) ---
  useEffect(() => {
    if (!editor || !session?.user?.id) return
    let mounted = true

    ;(async () => {
      setLoading(true)
      hydratingRef.current = true
      try {
        const { data, error } = await supabase
          .from('canvas_states')
          .select('data')
          .eq('user_id', session.user.id)
          .single()

        if (error && error.code !== 'PGRST116') {
          console.error('Error cargando el estado:', error)
        }

        if (data?.data) {
          // 🔧 migra el snapshot a la versión actual del schema
          const migrated = store.schema.migrateSnapshot(data.data)
          store.loadSnapshot(migrated)
        }
      } catch (e) {
        console.error('Fallo al hidratar:', e)
      } finally {
        if (mounted) {
          hydratingRef.current = false
          setLoading(false)
        }
      }
    })()

    return () => { mounted = false }
  }, [editor, session?.user?.id, store])

  // --- AUTO-GUARDADO (debounce) ---
  useEffect(() => {
    if (!editor || !session?.user?.id) return

    const onAnyChange = () => {
      if (hydratingRef.current) return // ⛔️ no guardes durante carga
      if (savingTimeout.current) clearTimeout(savingTimeout.current)

      savingTimeout.current = setTimeout(async () => {
        try {
          const snapshot = store.getSnapshot()
          const { error } = await supabase
            .from('canvas_states')
            .upsert(
              {
                user_id: session.user.id,
                data: snapshot,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id', returning: 'minimal' } // 👈 clave
            )
          if (error) console.error('Error guardando snapshot:', error)
        } catch (e) {
          console.error('Excepción guardando snapshot:', e)
        }
      }, 800) // 800–1200ms va bien
    }

    // 💡 Relaja filtros para no perder eventos relevantes
    const unsubscribe = store.listen(onAnyChange /* no filters */)

    return () => {
      unsubscribe()
      if (savingTimeout.current) clearTimeout(savingTimeout.current)
    }
  }, [editor, session?.user?.id, store])

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        store={store}
        onMount={setEditor}
        overrides={uiOverrides}
        forceDarkMode
        gridMode
      />
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: '#1e1e1e', color: 'white', zIndex: 1000
        }}>
          Cargando canvas...
        </div>
      )}
    </div>
  )
}
