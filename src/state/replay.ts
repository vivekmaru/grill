import type { Event } from '@/schema/events'
import { reduce } from './reducer'
import type { State } from './states'

export function replay(events: readonly Event[]): State {
  let state: State = 'ingest'
  for (const e of events) {
    state = reduce(state, e)
  }
  return state
}
