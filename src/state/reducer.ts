import type { Event } from '@/schema/events'
import { allowedEventsFor, type State } from './states'

/**
 * Pure (state, event) → state. No I/O. Throws on illegal transitions so
 * callers (the orchestrator + tests) catch state-machine bugs loudly.
 */
export function reduce(state: State, event: Event): State {
  if (!allowedEventsFor(state).includes(event.type)) {
    throw new Error(
      `event ${event.type} not allowed in state ${state}`,
    )
  }

  // END_INTERROGATION is the universal escape hatch from gather/critique/finalReview.
  if (event.type === 'END_INTERROGATION') {
    return 'generate'
  }

  switch (state) {
    case 'ingest':
      if (event.type === 'CONFIRM_INGEST') return 'target'
      return 'ingest'
    case 'target':
      if (event.type === 'SET_TARGET') return 'persona'
      return 'target'
    case 'persona':
      if (event.type === 'CONFIRM_PERSONA' || event.type === 'OVERRIDE_PERSONA') {
        return 'gather'
      }
      return 'persona'
    case 'gather':
      // gather→critique happens via the orchestrator emitting an internal
      // event after gather is complete (lands in sub-plan 3). For now, the
      // only user-facing exit from gather is END_INTERROGATION (handled above).
      return 'gather'
    case 'critique':
      if (event.type === 'PROCEED_TO_GENERATE') return 'finalReview'
      return 'critique'
    case 'finalReview':
      if (event.type === 'PROCEED_TO_GENERATE') return 'generate'
      return 'finalReview'
    case 'generate':
      if (event.type === 'PICK_TEMPLATE') return 'edit'
      return 'generate'
    case 'edit':
      if (event.type === 'EXPORT') return 'export'
      return 'edit'
    case 'export':
      return 'export'
  }
}
