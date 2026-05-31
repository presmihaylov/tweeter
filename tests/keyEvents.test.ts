import { describe, expect, test } from 'bun:test'
import { isCtrlEnterKey, isEnterKey } from '../src/app/keyEvents.ts'

describe('key event helpers', () => {
  test('recognizes OpenTUI enter aliases', () => {
    expect(isEnterKey({ name: 'enter', ctrl: false })).toBe(true)
    expect(isEnterKey({ name: 'return', ctrl: false })).toBe(true)
    expect(isEnterKey({ name: 'kpenter', ctrl: false })).toBe(true)
    expect(isEnterKey({ name: 'linefeed', ctrl: false })).toBe(true)
  })

  test('recognizes ctrl enter aliases', () => {
    expect(isCtrlEnterKey({ name: 'enter', ctrl: true })).toBe(true)
    expect(isCtrlEnterKey({ name: 'return', ctrl: true })).toBe(true)
    expect(isCtrlEnterKey({ name: 'j', ctrl: true })).toBe(true)
    expect(isCtrlEnterKey({ name: 'm', ctrl: true })).toBe(true)
    expect(isCtrlEnterKey({ name: 'unknown', ctrl: true, sequence: '\n' })).toBe(true)
  })
})
