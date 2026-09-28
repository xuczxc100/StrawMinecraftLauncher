import { isProxy, reactive, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { toPlain } from '../../src/renderer/src/api'

describe('renderer toPlain (IPC argument cloning)', () => {
  it('unwraps nested reactive proxies into structured-clone-safe data', () => {
    const include = ref(['mods', 'config'])
    const form = reactive({ name: 'Pack', nested: { list: [{ a: 1 }] } })
    const plain = toPlain({ include: include.value, form })
    expect(isProxy(plain.include)).toBe(false)
    expect(isProxy(plain.form)).toBe(false)
    expect(isProxy(plain.form.nested.list[0])).toBe(false)
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain).toEqual({ include: ['mods', 'config'], form: { name: 'Pack', nested: { list: [{ a: 1 }] } } })
  })

  it('keeps undefined properties so patches can clear fields', () => {
    const plain = toPlain({ javaPath: undefined, maxMemory: 2048 })
    expect('javaPath' in plain).toBe(true)
    expect(plain.javaPath).toBeUndefined()
  })

  it('passes primitives through', () => {
    expect(toPlain('x')).toBe('x')
    expect(toPlain(3)).toBe(3)
    expect(toPlain(undefined)).toBeUndefined()
  })
})
