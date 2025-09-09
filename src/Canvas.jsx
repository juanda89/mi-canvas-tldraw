import { Tldraw, DefaultMainMenu, TldrawUiMenuItem, useEditor } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { supabase } from './supabaseClient'
import { useCallback } from 'react'

// Simple throttle function
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

// Custom Main Menu with Sign Out button
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
  const userId = session.user.id;

  const handleSave = async (editor) => {
    const snapshot = editor.store.getSnapshot();
    
    const { error } = await supabase
      .from('canvas_states')
      .upsert(
        { user_id: userId, data: snapshot, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error('Error saving canvas state:', error);
    }
  };

  const throttledSave = useCallback(throttle(handleSave, 1000), [userId]);

  const handleLoad = async (editor) => {
    const { data, error } = await supabase
      .from('canvas_states')
      .select('data')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('Error loading canvas state:', error);
      return;
    }

    if (data && data.data) {
        editor.store.loadSnapshot(data.data);
    }
  };

  const handleEditorMount = (editor) => {
    handleLoad(editor);

    // Listen for changes to save them
    const handleChange = (change) => {
        // We only want to save changes made by the user
        if(change.source === 'user') {
            throttledSave(editor);
        }
    };

    const cleanup = editor.store.listen(handleChange);

    // Optional: Return a cleanup function for when the component unmounts
    return () => {
        cleanup();
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        onMount={handleEditorMount}
        overrides={uiOverrides}
        forceDarkMode={true} // <-- Añadí esto para asegurar el modo oscuro
        gridMode={true}      // <-- Y la grilla
      />
    </div>
  )
} // <-- ¡AQUÍ ESTÁ LA LLAVE CORREGIDA!
