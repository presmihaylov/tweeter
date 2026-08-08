import { describe, expect, test } from 'bun:test'
import { isCtrlEnterKey, isEnterKey, isNewlineKey } from '../src/app/keyEvents.ts'

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

  test('reads shift enter and alt enter as a new line', () => {
    expect(isNewlineKey({ name: 'return', ctrl: false, shift: true })).toBe(true)
    expect(isNewlineKey({ name: 'enter', ctrl: false, shift: true })).toBe(true)
    expect(isNewlineKey({ name: 'kpenter', ctrl: false, meta: true })).toBe(true)
  })

  test('keeps plain enter and ctrl enter for sending', () => {
    expect(isNewlineKey({ name: 'return', ctrl: false })).toBe(false)
    expect(isNewlineKey({ name: 'return', ctrl: true, shift: true })).toBe(false)
    expect(isNewlineKey({ name: 'j', ctrl: false, shift: true })).toBe(false)
  })
})
