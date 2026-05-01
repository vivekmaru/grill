import type { Event } from '@/schema/events'

export type State =
  | 'ingest'
  | 'target'
  | 'persona'
  | 'gather'
  | 'critique'
  | 'finalReview'
  | 'generate'
  | 'edit'
  | 'export'

type EventType = Event['type']

const ALLOWED: Record<State, readonly EventType[]> = {
  ingest:      ['UPLOAD_RESUME', 'START_BLANK', 'CONFIRM_INGEST'],
  target:      ['SET_TARGET'],
  persona:     ['CONFIRM_PERSONA', 'OVERRIDE_PERSONA'],
  gather:      ['USER_MESSAGE', 'END_INTERROGATION'],
  critique:    [
    'USER_MESSAGE', 'ACCEPT_BULLET', 'REJECT_BULLET', 'SKIP_BULLET',
    'DISMISS_FLAG', 'END_INTERROGATION', 'PROCEED_TO_GENERATE',
  ],
  finalReview: ['USER_MESSAGE', 'PROCEED_TO_GENERATE', 'END_INTERROGATION'],
  generate:    ['PICK_TEMPLATE'],
  edit:        ['EDIT_RESUME', 'USER_MESSAGE', 'EXPORT'],
  export:      ['EXPORT'],
}

export function allowedEventsFor(state: State): readonly EventType[] {
  return ALLOWED[state]
}
