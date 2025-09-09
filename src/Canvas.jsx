import { Tldraw, DefaultMainMenu, TldrawUiMenuItem } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'
import { supabase } from './supabaseClient'

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
				icon="log-out"
			/>
		</DefaultMainMenu>
	)
}

const uiOverrides = {
	mainMenu: MyMainMenu,
}

  const handleSave = async (editor) => {
    const snapshot = editor.store.getSnapshot();
    // NOTE: tldraw snapshots are already JSON, so we don't need to stringify them again.
    
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

  const throttledSave = throttle(handleSave, 1000);

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
        // NOTE: The data is already a JS object, no need to parse it.
        editor.store.loadSnapshot(data.data);
    }
  };

  const handleEditorMount = (editor) => {
    handleLoad(editor);

    const handleChange = (change) => {
        // This check is to prevent an infinite loop of saves and loads
        if(change.source === 'user') {
            throttledSave(editor);
        }
    };

    editor.store.listen(handleChange);
  };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        onMount={handleEditorMount}
        overrides={uiOverrides}
      />
    </div>
  )
}
