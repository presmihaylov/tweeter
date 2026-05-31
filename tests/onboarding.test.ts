import { describe, expect, test } from 'bun:test'
import { appendOnboardingText, backspaceOnboardingField, initialOnboardingForm, maskSecret, nextOnboardingField, renderOnboardingForm, validateOnboardingForm } from '../src/auth/onboardingForm.ts'

describe('onboarding form', () => {
  test('edits fields and validates credentials', () => {
    let state = initialOnboardingForm()
    expect(state.focus).toBe('profileName')
    state = nextOnboardingField(state)
    state = appendOnboardingText(state, 'auth-token')
    state = nextOnboardingField(state)
    state = appendOnboardingText(state, 'csrf-token')
    const validated = validateOnboardingForm(state)
    expect('error' in validated).toBe(false)
    if (!('error' in validated)) {
      expect(validated.profileName).toBe('default')
      expect(validated.authToken).toBe('auth-token')
      expect(validated.ct0).toBe('csrf-token')
    }
  })

  test('moves focus, backspaces, masks secrets, renders OK button', () => {
    let state = initialOnboardingForm()
    state = nextOnboardingField(state)
    state = appendOnboardingText(state, 'abcdefghi')
    state = backspaceOnboardingField(state)
    expect(state.authToken).toBe('abcdefgh')
    expect(maskSecret(state.authToken)).toBe('abc••fgh')
    state = nextOnboardingField(nextOnboardingField(state))
    expect(state.focus).toBe('ok')
    expect(renderOnboardingForm(state)).toContain('[  OK  ]')
  })

  test('requires auth token and ct0', () => {
    const missing = validateOnboardingForm(initialOnboardingForm())
    expect(missing).toEqual({ error: 'auth_token is required', focus: 'authToken' })
  })
})
