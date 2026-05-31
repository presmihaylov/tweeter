export type AppKey = {
  name: string
  ctrl: boolean
  shift?: boolean
  sequence?: string
}

const enterNames = new Set(['enter', 'return', 'kpenter', 'linefeed'])
const ctrlEnterSequences = new Set(['\n', '\r'])

export const isEnterKey = (key: AppKey): boolean => {
  return enterNames.has(key.name)
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
