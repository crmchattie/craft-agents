import { atom } from 'jotai'
import type { CalendarEvent } from '@craft-agent/core/types'

export const calendarEventsAtom = atom<CalendarEvent[]>([])
export const calendarViewAtom = atom<'day' | 'week' | 'month'>('week')
export const calendarSelectedDateAtom = atom<string>(new Date().toISOString().slice(0, 10))
export const calendarSyncingAtom = atom<boolean>(false)
