import { useState } from 'react'
import { SetupScreen } from './screens/SetupScreen'
import { SessionScreen } from './screens/SessionScreen'

export function App() {
  const [sessionId, setSessionId] = useState<number | null>(null)

  return (
    <div style={{ minHeight: '100vh', background: '#09090b' }}>
      {sessionId ? (
        <SessionScreen sessionId={sessionId} />
      ) : (
        <SetupScreen onSessionCreated={(session) => setSessionId(session.id)} />
      )}
    </div>
  )
}
