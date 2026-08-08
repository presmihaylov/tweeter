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

const escape = String.fromCharCode(0x1b)

const isControlChar = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

const hasControlChar = (text: string): boolean => [...text].some(isControlChar)

// A paste arrives as one keypress carrying every character, and an arrow key arrives as an
// escape sequence. Only a sequence with nothing to control the terminal is text to insert.
export const isTextInput = (key: AppKey): key is AppKey & { sequence: string } =>
  key.sequence !== undefined && key.sequence !== '' && !key.ctrl && key.meta !== true
    && !hasControlChar(key.sequence)

// What the clipboard puts in the draft. The composer holds one line, so a line break becomes
// a space rather than nothing, and every other control character comes out. A newline left in
// the middle would send the draft, and an escape would read as an arrow key.
export const cleanPasted = (raw: string): string =>
  [...raw.replace(/\r\n|\r|\n/g, ' ')].filter((char) => !isControlChar(char)).join('').trimEnd()

// The same clipboard, from a terminal that answers Cmd+V without bracketed paste. It drops
// the whole text in as one keypress instead, which only the length tells apart from a
// keystroke. An escape sequence is many characters too, so a run that starts one is a key.
export const pastedText = (key: AppKey): string | undefined => {
  const raw = key.sequence
  if (raw === undefined || raw.length < 2 || key.ctrl || key.meta === true || raw.startsWith(escape)) {
    return undefined
  }
  const text = cleanPasted(raw)
  return text === '' ? undefined : text
}

// Terminals disagree about ? : some name the key, some report the / it shares with Shift,
// and some only carry the character in the sequence. All three mean the same press.
export const isHelpKey = (key: AppKey): boolean =>
  !key.ctrl && key.meta !== true && (key.name === '?' || (key.shift === true && key.name === '/') || key.sequence === '?')

// Shift+S opens the stats page. s already sorts the feed, and terminals disagree about how
// a capital arrives: some name the shifted letter, some name the key and mark the Shift.
export const isStatsKey = (key: AppKey): boolean =>
  !key.ctrl && key.meta !== true && (key.name === 'S' || (key.shift === true && key.name === 's'))

// Shift+F follows or unfollows the author of the open tweet. A plain f is free, but the two
// writes on the account itself carry a Shift, as Shift+P and Shift+S do.
export const isFollowKey = (key: AppKey): boolean =>
  !key.ctrl && key.meta !== true && (key.name === 'F' || (key.shift === true && key.name === 'f'))

// How far the key popup moves. A short terminal cannot hold every key at once, so the same
// keys that walk a list walk the popup, and the page keys jump a screen.
export const helpScrollStep = (key: AppKey): number => {
  if (key.name === 'down' || key.name === 'j') {
    return 1
  }
  if (key.name === 'up' || key.name === 'k') {
    return -1
  }
  if (key.name === 'pagedown' || key.name === 'space') {
    return 10
  }
  return key.name === 'pageup' ? -10 : 0
}

// Enter sends the draft, so a line break needs its own press. A terminal that speaks the
// kitty keyboard protocol marks the Shift; one that does not can send Alt+Enter instead.
export const isNewlineKey = (key: AppKey): boolean => {
  if (key.ctrl) {
    return false
  }
  return (key.shift === true || key.meta === true) && enterNames.has(key.name)
}

export const isCtrlEnterKey = (key: AppKey): boolean => {
  if (key.ctrl && enterNames.has(key.name)) {
    return true
  }
  if (key.ctrl && key.sequence && ctrlEnterSequences.has(key.sequence)) {
    return true
  }
  return key.ctrl && (key.name === 'j' || key.name === 'm')
}
