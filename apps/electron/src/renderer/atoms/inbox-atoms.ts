import { atom } from 'jotai'
import type { InboxMessage } from '@craft-agent/core/types'

export interface InboxFilter {
  view: 'all' | 'actionable'
  source: string | null
  channel: string | null
}

export const inboxMessagesAtom = atom<InboxMessage[]>([])
export const inboxFilterAtom = atom<InboxFilter>({ view: 'all', source: null, channel: null })
export const selectedMessageIdAtom = atom<string | null>(null)
export const inboxSyncingAtom = atom<boolean>(false)

export const inboxUnreadCountAtom = atom<number>((get) =>
  get(inboxMessagesAtom).filter(m => !m.isRead).length
)

export const inboxActionableCountAtom = atom<number>((get) =>
  get(inboxMessagesAtom).filter(m => m.triage?.isActionable).length
)
