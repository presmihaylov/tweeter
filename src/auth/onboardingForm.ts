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

