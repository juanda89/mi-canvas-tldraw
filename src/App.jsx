import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import Canvas from './Canvas'

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true) // Agregar estado de carga
  const [error, setError] = useState(null) // Agregar manejo de errores

  useEffect(() => {
    let mounted = true // Para evitar actualizaciones de estado si el componente se desmonta

    // Obtener sesión inicial
    const getInitialSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('Error obteniendo sesión:', error)
          setError('Error al cargar la sesión')
          return
        }

        if (mounted) {
          setSession(session)
        }
      } catch (err) {
        console.error('Error inesperado:', err)
        if (mounted) {
          setError('Error inesperado al cargar la aplicación')
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    getInitialSession()

    // Listener para cambios de autenticación
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setSession(session)
        setError(null) // Limpiar errores cuando la auth cambia
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // Estado de carga inicial
  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p style={styles.loadingText}>Cargando aplicación...</p>
      </div>
    )
  }

  // Estado de error
  if (error) {
    return (
      <div style={styles.errorContainer}>
        <h2 style={styles.errorTitle}>¡Oops! Algo salió mal</h2>
        <p style={styles.errorMessage}>{error}</p>
        <button 
          style={styles.retryButton}
          onClick={() => window.location.reload()}
        >
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div style={styles.appContainer}>
      {!session ? (
        <div style={styles.authContainer}>
          <div style={styles.authBox}>
            <h1 style={styles.authTitle}>Bienvenido al Whiteboard</h1>
            <p style={styles.authSubtitle}>Inicia sesión para comenzar</p>
            <Auth
              supabaseClient={supabase}
              appearance={{ 
                theme: ThemeSupa,
                style: {
                  button: { 
                    background: '#3b82f6', 
                    color: 'white',
                    borderRadius: '8px'
                  },
                  input: { 
                    borderRadius: '8px' 
                  }
                }
              }}
              theme="dark"
              providers={['google']}
              localization={{
                variables: {
                  sign_in: {
                    email_label: 'Correo electrónico',
                    password_label: 'Contraseña',
                    button_label: 'Iniciar sesión',
                    loading_button_label: 'Iniciando sesión...',
                  },
                  sign_up: {
                    email_label: 'Correo electrónico',
                    password_label: 'Contraseña',
                    button_label: 'Registrarse',
                    loading_button_label: 'Registrándose...',
                  }
                }
              }}
            />
          </div>
        </div>
      ) : (
        <Canvas session={session} />
      )}
    </div>
  )
}

// Estilos organizados
const styles = {
  appContainer: {
    width: '100vw',
    height: '100vh',
    margin: 0,
    padding: 0,
    overflow: 'hidden'
  },
  
  authContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  
  authBox: {
    background: '#1e293b',
    padding: '2rem',
    borderRadius: '12px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    border: '1px solid #334155',
    minWidth: '400px',
    textAlign: 'center'
  },
  
  authTitle: {
    color: '#f1f5f9',
    fontSize: '2rem',
    fontWeight: '700',
    margin: '0 0 0.5rem 0'
  },
  
  authSubtitle: {
    color: '#94a3b8',
    fontSize: '1rem',
    margin: '0 0 2rem 0'
  },
  
  loadingContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    background: '#1e293b',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #334155',
    borderTop: '4px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  
  loadingText: {
    color: '#94a3b8',
    fontSize: '1.1rem',
    marginTop: '1rem'
  },
  
  errorContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    background: '#1e293b',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    textAlign: 'center',
    padding: '2rem'
  },
  
  errorTitle: {
    color: '#ef4444',
    fontSize: '2rem',
    fontWeight: '700',
    margin: '0 0 1rem 0'
  },
  
  errorMessage: {
    color: '#94a3b8',
    fontSize: '1.1rem',
    margin: '0 0 2rem 0'
  },
  
  retryButton: {
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    padding: '0.75rem 1.5rem',
    borderRadius: '8px',
    fontSize: '1rem',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'background-color 0.2s ease'
  }
}

export default App