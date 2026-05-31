export type OnboardingField = 'profileName' | 'authToken' | 'ct0' | 'ok'

export type OnboardingFormState = {
  profileName: string
  authToken: string
  ct0: string
  focus: OnboardingField
  error?: string
  saving: boolean
}

export type OnboardingCredentials = {
  profileName: string
  authToken: string
  ct0: string
}

const fields: OnboardingField[] = ['profileName', 'authToken', 'ct0', 'ok']

export const initialOnboardingForm = (): OnboardingFormState => ({
  profileName: 'default',
  authToken: '',
  ct0: '',
  focus: 'profileName',
  saving: false
})

export const nextOnboardingField = (state: OnboardingFormState, direction: 1 | -1 = 1): OnboardingFormState => {
  const current = fields.indexOf(state.focus)
  const next = (current + direction + fields.length) % fields.length
  return { ...state, focus: fields[next] ?? 'profileName', error: undefined }
}

export const appendOnboardingText = (state: OnboardingFormState, text: string): OnboardingFormState => {
  if (state.focus === 'ok') {
    return state
  }
  return { ...state, [state.focus]: `${state[state.focus]}${text}`, error: undefined }
}

export const backspaceOnboardingField = (state: OnboardingFormState): OnboardingFormState => {
  if (state.focus === 'ok') {
    return state
  }
  return { ...state, [state.focus]: state[state.focus].slice(0, -1), error: undefined }
}

export const validateOnboardingForm = (state: OnboardingFormState): OnboardingCredentials | { error: string; focus: OnboardingField } => {
  const profileName = state.profileName.trim() || 'default'
  if (state.authToken.trim() === '') {
    return { error: 'auth_token is required', focus: 'authToken' }
  }
  if (state.ct0.trim() === '') {
    return { error: 'ct0 is required', focus: 'ct0' }
  }
  return { profileName, authToken: state.authToken.trim(), ct0: state.ct0.trim() }
}

export const maskSecret = (value: string): string => {
  if (value === '') {
    return ''
  }
  if (value.length <= 6) {
    return '•'.repeat(value.length)
  }
  return `${value.slice(0, 3)}${'•'.repeat(Math.min(24, value.length - 6))}${value.slice(-3)}`
}

export const renderOnboardingForm = (state: OnboardingFormState): string => {
  const profile = fieldBox('profile', state.profileName, state.focus === 'profileName', false)
  const auth = fieldBox('auth_token', maskSecret(state.authToken), state.focus === 'authToken', true)
  const ct0 = fieldBox('ct0', maskSecret(state.ct0), state.focus === 'ct0', true)
  const ok = state.focus === 'ok' ? '[  OK  ]' : '   OK   '
  return [
    'birdtui first launch',
    '',
    'Paste your X cookies here. They are saved locally to ~/.config/birdtui/config.json.',
    '',
    'How to get them:',
    '1. Open https://x.com and make sure you are logged in.',
    '2. DevTools -> Application/Storage -> Cookies -> https://x.com.',
    '3. Copy auth_token and ct0 below.',
    '',
    profile,
    auth,
    ct0,
    '',
    ok,
    '',
    'Tab / Shift+Tab move fields · type/paste values · Enter advances/submits · q quits',
    state.saving ? 'saving...' : '',
    state.error ? `error: ${state.error}` : ''
  ].filter((line) => line !== '').join('\n')
}

const fieldBox = (label: string, value: string, focused: boolean, secret: boolean): string => {
  const width = 72
  const display = value || (secret ? '<paste secret>' : '<profile name>')
  const clipped = display.length > width - 4 ? display.slice(0, width - 7) + '...' : display
  const border = focused ? '=' : '-'
  const top = `+${border.repeat(width - 2)}+`
  const title = `${label}${focused ? ' *' : ''}`
  const paddedTitle = `| ${title.padEnd(width - 4, ' ')} |`
  const paddedValue = `| ${clipped.padEnd(width - 4, ' ')} |`
  return `${top}\n${paddedTitle}\n${paddedValue}\n${top}`
}
