import type { CaretMove } from '../state/store.ts'

export type AppKey = {
  name: string
  ctrl: boolean
  shift?: boolean
  meta?: boolean
  sequence?: string
}

const enterNames = new Set(['enter', 'return', 'kpenter', 'linefeed'])
const ctrlEnterSequences = new Set(['\n', '\r'])

export const isEnterKey = (key: AppKey): boolean => {
  return enterNames.has(key.name)
}

// The composer answers the keys any text field answers. Alt+arrow is how macOS jumps a
// word, and Ctrl+A and Ctrl+E are the two ends, as in a shell.
export const caretMoveFor = (key: AppKey): CaretMove | undefined => {
  const word = key.meta === true || key.ctrl
  if (key.name === 'left') {
    return word ? 'wordLeft' : 'left'
  }
  if (key.name === 'right') {
    return word ? 'wordRight' : 'right'
  }
  if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
    return 'start'
  }
  if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
    return 'end'
  }
  return undefined
}

const hasControlChar = (text: string): boolean =>
  [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code < 0x20 || code === 0x7f
  })

// A paste arrives as one keypress carrying every character, and an arrow key arrives as an
// escape sequence. Only a sequence with nothing to control the terminal is text to insert.
export const isTextInput = (key: AppKey): key is AppKey & { sequence: string } =>
  key.sequence !== undefined && key.sequence !== '' && !key.ctrl && key.meta !== true
    && !hasControlChar(key.sequence)

export const isCtrlEnterKey = (key: AppKey): boolean => {
  if (key.ctrl && enterNames.has(key.name)) {
    return true
  }
  if (key.ctrl && key.sequence && ctrlEnterSequences.has(key.sequence)) {
    return true
  }
  return key.ctrl && (key.name === 'j' || key.name === 'm')
}
