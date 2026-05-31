import { getMap, getSlice, getStr } from '../../utils/guards.ts'

export const extractCursorFromInstructions = (instructions: unknown[], cursorType: 'Top' | 'Bottom' = 'Bottom'): string | undefined => {
  for (const instruction of instructions) {
    for (const entry of getSlice(instruction, 'entries') ?? []) {
      const content = getMap(entry, 'content')
      if (getStr(content, 'cursorType') !== cursorType) {
        continue
      }
      const value = getStr(content, 'value')
      if (value !== '') {
        return value
      }
    }
  }
  return undefined
}
