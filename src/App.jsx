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
        <div style={styles.authLayout}>
          <div style={styles.leftPanel}>
            <div style={styles.brandBadge}>
              <span style={styles.brandDot} />
              <span>mi-canvas</span>
            </div>
            <h1 style={styles.headline}>Crea, comparte y colabora.</h1>
            <p style={styles.tagline}>Un lienzo colaborativo, simple y potente.</p>
            <div style={styles.leftDecor} />
          </div>
          <div style={styles.rightPanel}>
            <div style={styles.authCard}>
              <h2 style={styles.cardTitle}>Bienvenido</h2>
              <p style={styles.cardSubtitle}>Inicia sesión para continuar</p>
              <Auth
                supabaseClient={supabase}
                appearance={{
                  theme: ThemeSupa,
                  variables: {
                    default: {
                      colors: {
                        brand: '#387FFF',
                        brandAccent: '#2F6DE0',
                        inputBackground: '#0E1426',
                        inputBorder: '#2A3555',
                        inputText: '#E5E7EB',
                        inputLabelText: '#9AA4B2',
                        messageText: '#9AA4B2',
                        defaultButtonBackground: '#387FFF',
                        defaultButtonText: '#0B1220',
                      },
                      radii: {
                        borderRadiusButton: '10px',
                        inputBorderRadius: '10px',
                      },
                      fonts: {
                        bodyFontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                        buttonFontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                      },
                      space: {
                        inputPadding: '12px',
                        buttonPadding: '12px 16px',
                      },
                    },
                  },
                  style: {
                    container: { width: '100%' },
                    button: {
                      background: '#387FFF',
                      color: '#0B1220',
                      border: '1px solid rgba(56,127,255,0.55)',
                      borderRadius: '10px',
                      fontWeight: 600,
                    },
                    input: {
                      background: 'rgba(11,18,32,0.8)',
                      border: '1px solid #2A3555',
                      color: '#E5E7EB',
                      borderRadius: '10px',
                    },
                    anchor: { color: '#8FB6FF' },
                    label: { color: '#9aa4b2' },
                    message: { color: '#9aa4b2' },
                  },
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
                    },
                  },
                }}
              />
              <p style={styles.cardFooter}>Protegido por Supabase Auth</p>
            </div>
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
  
  authLayout: {
    width: '100%',
    height: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    background: 'radial-gradient(1200px 500px at 10% -10%, rgba(56,127,255,0.20), transparent 50%), radial-gradient(1000px 600px at 110% 110%, rgba(56,127,255,0.12), transparent 50%), linear-gradient(180deg, #0B1220, #0B1220)',
    position: 'relative',
    overflow: 'hidden'
  },

  leftPanel: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '3.5rem',
    color: '#E5E7EB',
    backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
    backgroundSize: '24px 24px',
    borderRight: '1px solid rgba(148,163,184,0.08)'
  },

  rightPanel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
  },

  brandBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(56,127,255,0.12)',
    color: '#BFD6FF',
    border: '1px solid rgba(56,127,255,0.25)',
    padding: '6px 12px',
    borderRadius: '9999px',
    width: 'fit-content',
    fontSize: '0.9rem',
    fontWeight: 600,
    letterSpacing: '0.2px',
    marginBottom: '1.25rem'
  },

  brandDot: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '9999px',
    background: 'linear-gradient(180deg, #41A0FF, #2F6DE0)',
    boxShadow: '0 0 0 3px rgba(56,127,255,0.20)'
  },

  headline: {
    fontSize: '3rem',
    lineHeight: 1.1,
    margin: 0,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: '#F8FAFC'
  },

  tagline: {
    marginTop: '0.75rem',
    color: '#9AA4B2',
    fontSize: '1.1rem'
  },

  leftDecor: {
    position: 'absolute',
    bottom: '-60px',
    left: '-60px',
    width: '220px',
    height: '220px',
    background: 'conic-gradient(from 180deg at 50% 50%, rgba(56,127,255,0.35), transparent 60%)',
    filter: 'blur(40px)',
    opacity: 0.7,
    pointerEvents: 'none'
  },

  authCard: {
    width: '420px',
    background: 'rgba(10, 15, 30, 0.7)',
    border: '1px solid rgba(80,120,180,0.18)',
    boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(8px)',
    borderRadius: '16px',
    padding: '28px',
  },

  cardTitle: {
    color: '#f8fafc',
    fontSize: '1.5rem',
    fontWeight: 700,
    margin: '0 0 0.25rem 0',
    letterSpacing: '-0.01em'
  },

  cardSubtitle: {
    color: '#93a3b8',
    fontSize: '0.95rem',
    margin: '0 0 1rem 0'
  },

  cardFooter: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: '0.75rem',
    fontSize: '0.85rem'
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
