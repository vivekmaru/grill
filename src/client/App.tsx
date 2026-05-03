import { useState } from 'react'
import { SetupScreen } from './screens/SetupScreen'
import { SessionScreen } from './screens/SessionScreen'

export function App() {
  const [sessionId, setSessionId] = useState<number | null>(null)

  return (
    <main className="min-h-screen bg-background py-8">
      {sessionId ? (
        <SessionScreen sessionId={sessionId} />
      ) : (
        <SetupScreen onSessionCreated={(session) => setSessionId(session.id)} />
      )}
    </main>
  )
}
