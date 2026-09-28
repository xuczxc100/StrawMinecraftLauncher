import { baseCompile } from '@intlify/message-compiler'
import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/src/i18n/en'
import zhTW from '../../src/renderer/src/i18n/zh-TW'
import { contrastText } from '../../src/renderer/src/stores/app'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v]] : Object.entries(flatten(v, `${prefix}${k}.`)))),
  )
}

describe('i18n messages', () => {
  const zh = flatten(zhTW as Tree)
  const eng = flatten(en as Tree)

  it('zh-TW and en define the same keys', () => {
    expect(Object.keys(eng).sort()).toEqual(Object.keys(zh).sort())
  })

  it.each([
    ['zh-TW', zh],
    ['en', eng],
  ])('%s messages all compile (no stray @ | { syntax)', (_, messages) => {
    const broken: string[] = []
    for (const [key, message] of Object.entries(messages)) {
      baseCompile(message, { onError: (e) => broken.push(`${key}: ${e.message}`) })
    }
    expect(broken).toEqual([])
  })

  it('uses the same placeholders in both languages', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(zh)) expect(vars(eng[key]), key).toEqual(vars(zh[key]))
  })
})

describe('accent contrast', () => {
  it('uses dark text on light accents and white on dark ones', () => {
    expect(contrastText('#e0a526')).toBe('#1b1406')
    expect(contrastText('#ffffff')).toBe('#1b1406')
    expect(contrastText('#1a237e')).toBe('#ffffff')
  })
})
