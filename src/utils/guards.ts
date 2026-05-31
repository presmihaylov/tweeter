export type JsonObject = Record<string, unknown>

export const isRecord = (value: unknown): value is JsonObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const getMap = (value: unknown, key: string): JsonObject | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const next = value[key]
  if (!isRecord(next)) {
    return undefined
  }
  return next
}

export const getSlice = (value: unknown, key: string): unknown[] | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const next = value[key]
  if (!Array.isArray(next)) {
    return undefined
  }
  return next
}

export const getStr = (value: unknown, key: string): string => {
  if (!isRecord(value)) {
    return ''
  }
  const next = value[key]
  if (typeof next === 'string') {
    return next
  }
  return ''
}

export const getBool = (value: unknown, key: string): boolean => {
  if (!isRecord(value)) {
    return false
  }
  return value[key] === true
}

export const getInt = (value: unknown, key: string): number => {
  if (!isRecord(value)) {
    return 0
  }
  const next = value[key]
  if (typeof next === 'number' && Number.isFinite(next)) {
    return Math.trunc(next)
  }
  if (typeof next === 'string' && /^\d+$/.test(next)) {
    return Number.parseInt(next, 10)
  }
  return 0
}

export const getFloat = (value: unknown, key: string): number => {
  if (!isRecord(value)) {
    return 0
  }
  const next = value[key]
  if (typeof next === 'number' && Number.isFinite(next)) {
    return next
  }
  return 0
}

export const compact = <T>(values: Array<T | undefined>): T[] => values.filter((value): value is T => value !== undefined)
