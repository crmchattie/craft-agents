import { atom } from 'jotai'
import type { CalendarEvent } from '@scrunchy/core/types'

export const calendarEventsAtom = atom<CalendarEvent[]>([])
export const calendarViewAtom = atom<'day' | 'week' | 'month'>('week')
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const calendarSelectedDateAtom = atom<string>(todayLocal())
export const calendarSyncingAtom = atom<boolean>(false)
