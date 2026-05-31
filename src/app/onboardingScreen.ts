import { BoxRenderable, InputRenderable, TextRenderable, type CliRenderer } from '@opentui/core'
import { initialOnboardingForm, validateOnboardingForm, type OnboardingCredentials, type OnboardingField, type OnboardingFormState } from '../auth/onboardingForm.ts'
import { isEnterKey } from './keyEvents.ts'

export type OnboardingScreen = {
  destroy(): void
  setError(error: string): void
  setSaving(saving: boolean): void
}

export const createOnboardingScreen = (
  renderer: CliRenderer,
  onSubmit: (credentials: OnboardingCredentials) => Promise<void>
): OnboardingScreen => {
  let state: OnboardingFormState = initialOnboardingForm()
  let destroyed = false

  const shell = new BoxRenderable(renderer, {
    id: 'onboarding-shell',
    width: '100%',
    height: '100%',
    backgroundColor: '#090d12',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  })

  const card = new BoxRenderable(renderer, {
    id: 'onboarding-card',
    width: 92,
    height: 34,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    padding: 2,
    flexDirection: 'column',
    gap: 1
  })

  const eyebrow = new TextRenderable(renderer, {
    id: 'onboarding-eyebrow',
    content: 'LOCAL X/TWITTER CLIENT',
    fg: '#7d8590',
    height: 1,
    width: '100%'
  })

  const title = new TextRenderable(renderer, {
    id: 'onboarding-title',
    content: 'Connect birdtui',
    fg: '#f0f6fc',
    height: 1,
    width: '100%'
  })

  const subtitle = new TextRenderable(renderer, {
    id: 'onboarding-subtitle',
    content: 'Paste your X cookies once. They stay local in ~/.config/birdtui/config.json.',
    fg: '#8b949e',
    height: 1,
    width: '100%'
  })

  const help = new TextRenderable(renderer, {
    id: 'onboarding-help',
    content: 'Get cookies from x.com → DevTools → Application/Storage → Cookies → auth_token + ct0',
    fg: '#58a6ff',
    height: 1,
    width: '100%'
  })

  const profileField = createField(renderer, 'profile-field', 'Profile', 'default', false)
  const authField = createField(renderer, 'auth-field', 'auth_token', 'paste auth_token', true)
  const ct0Field = createField(renderer, 'ct0-field', 'ct0', 'paste ct0', true)

  const footer = new BoxRenderable(renderer, {
    id: 'onboarding-footer',
    width: '100%',
    height: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2
  })

  const okButton = new BoxRenderable(renderer, {
    id: 'onboarding-ok',
    width: 16,
    height: 3,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#238636',
    backgroundColor: '#12301c',
    alignItems: 'center',
    justifyContent: 'center',
    onMouseDown: () => { void submit() }
  })
  const okText = new TextRenderable(renderer, {
    id: 'onboarding-ok-text',
    content: 'OK',
    fg: '#3fb950',
    width: 4,
    height: 1
  })
  okButton.add(okText)

  const statusText = new TextRenderable(renderer, {
    id: 'onboarding-status',
    content: 'Tab moves · Enter submits · click OK · q quits',
    fg: '#7d8590',
    height: 2,
    flexGrow: 1,
    wrapMode: 'word'
  })

  footer.add(okButton)
  footer.add(statusText)

  card.add(eyebrow)
  card.add(title)
  card.add(subtitle)
  card.add(help)
  card.add(profileField.row)
  card.add(authField.row)
  card.add(ct0Field.row)
  card.add(footer)
  shell.add(card)
  renderer.root.add(shell)

  const order: OnboardingField[] = ['profileName', 'authToken', 'ct0', 'ok']
  const inputs = { profileName: profileField.input, authToken: authField.input, ct0: ct0Field.input }
  const rows = { profileName: profileField.row, authToken: authField.row, ct0: ct0Field.row, ok: okButton }

  const syncFocus = (): void => {
    for (const field of order) {
      const focused = state.focus === field
      rows[field].borderColor = focused ? '#58a6ff' : field === 'ok' ? '#238636' : '#30363d'
      rows[field].backgroundColor = focused ? '#111b2b' : field === 'ok' ? '#12301c' : '#0d1117'
    }
    if (state.focus !== 'ok') {
      inputs[state.focus].focus()
    }
    statusText.content = state.saving ? 'Saving credentials…' : state.error ?? 'Tab moves · Enter submits · click OK · q quits'
    statusText.fg = state.error ? '#ff7b72' : state.saving ? '#f2cc60' : '#7d8590'
    renderer.requestRender()
  }

  const moveFocus = (direction: 1 | -1): void => {
    const current = order.indexOf(state.focus)
    const next = (current + direction + order.length) % order.length
    state = { ...state, focus: order[next] ?? 'profileName', error: undefined }
    syncFocus()
  }

  const submit = async (): Promise<void> => {
    if (state.saving) {
      return
    }
    state = {
      ...state,
      profileName: profileField.input.value,
      authToken: authField.input.value,
      ct0: ct0Field.input.value,
      error: undefined
    }
    const validated = validateOnboardingForm(state)
    if ('error' in validated) {
      state = { ...state, error: validated.error, focus: validated.focus }
      syncFocus()
      return
    }
    state = { ...state, saving: true }
    syncFocus()
    await onSubmit(validated)
  }

  const onGlobalKey = (key: { name: string; shift: boolean }): void => {
    if (key.name === 'q') {
      renderer.destroy()
      return
    }
    if (key.name === 'tab') {
      moveFocus(key.shift ? -1 : 1)
      return
    }
    if (isEnterKey({ ...key, ctrl: false }) && state.focus === 'ok') {
      void submit()
    }
  }

  profileField.input.on('input', (value: string) => { state = { ...state, profileName: value, error: undefined } })
  authField.input.on('input', (value: string) => { state = { ...state, authToken: value, error: undefined } })
  ct0Field.input.on('input', (value: string) => { state = { ...state, ct0: value, error: undefined } })
  profileField.input.on('enter', () => moveFocus(1))
  authField.input.on('enter', () => moveFocus(1))
  ct0Field.input.on('enter', () => { state = { ...state, focus: 'ok' }; syncFocus() })
  renderer.keyInput.on('keypress', onGlobalKey)

  syncFocus()

  return {
    destroy() {
      if (destroyed) {
        return
      }
      destroyed = true
      renderer.keyInput.off('keypress', onGlobalKey)
      renderer.root.remove(shell.id)
      shell.destroyRecursively()
      renderer.requestRender()
    },
    setError(error: string) {
      state = { ...state, saving: false, error }
      syncFocus()
    },
    setSaving(saving: boolean) {
      state = { ...state, saving }
      syncFocus()
    }
  }
}

const createField = (renderer: CliRenderer, id: string, label: string, placeholder: string, secret: boolean) => {
  const row = new BoxRenderable(renderer, {
    id,
    width: '100%',
    height: 5,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    flexDirection: 'column',
    paddingX: 1
  })
  const labelText = new TextRenderable(renderer, {
    id: `${id}-label`,
    content: label,
    fg: '#8b949e',
    width: '100%',
    height: 1
  })
  const input = new InputRenderable(renderer, {
    id: `${id}-input`,
    value: label === 'Profile' ? 'default' : '',
    placeholder,
    width: '100%',
    maxLength: 4096,
    backgroundColor: '#0d1117',
    focusedBackgroundColor: '#111b2b',
    textColor: secret ? '#f2cc60' : '#f0f6fc',
    focusedTextColor: secret ? '#f2cc60' : '#f0f6fc',
    placeholderColor: '#484f58'
  })
  row.add(labelText)
  row.add(input)
  return { row, input }
}
