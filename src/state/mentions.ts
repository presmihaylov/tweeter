// What X allows in a handle, and how long one can run.
const handleChar = /[A-Za-z0-9_]/
// What ends the word before the @: an address and a second @ both fail this.
const wordChar = /[A-Za-z0-9_@]/
const handleLimit = 15

// The @word the caret sits at the end of, without the @. A handle only starts a word, so an
// email address does not open the list, and a caret in the middle of a word does not either:
// completing there would push the rest of the word out of the way.
export const mentionQuery = (draft: string, caret: number): string | undefined => {
  const after = draft[caret] ?? ''
  if (after !== '' && handleChar.test(after)) {
    return undefined
  }
  let start = caret
  while (start > 0 && handleChar.test(draft[start - 1] ?? '')) {
    start -= 1
  }
  const query = draft.slice(start, caret)
  if (draft[start - 1] !== '@' || query.length === 0 || query.length > handleLimit) {
    return undefined
  }
  const before = draft[start - 2] ?? ''
  return before === '' || !wordChar.test(before) ? query : undefined
}

// The chosen handle takes the place of what was typed, and a space follows it, because the
// mention is finished and the next word is not part of it.
export const applyMention = (draft: string, caret: number, handle: string): { draft: string; caret: number } => {
  const query = mentionQuery(draft, caret)
  if (query === undefined) {
    return { draft, caret }
  }
  const start = caret - query.length - 1
  const inserted = `@${handle} `
  return { draft: `${draft.slice(0, start)}${inserted}${draft.slice(caret)}`, caret: start + inserted.length }
}
