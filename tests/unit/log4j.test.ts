import { describe, expect, it } from 'vitest'
import { Log4jLineParser } from '../../src/main/util/log4j'

const ts = new Date(2026, 8, 28, 14, 5, 9).getTime()
const sample = `<log4j:Event logger="enn" timestamp="${ts}" level="INFO" thread="Render thread">
  <log4j:Message><![CDATA[Setting user: SmclTester]]></log4j:Message>
</log4j:Event>
<log4j:Event logger="fyn" timestamp="${ts}" level="ERROR" thread="Render thread">
  <log4j:Message><![CDATA[Failed to verify authentication]]></log4j:Message>
  <log4j:Throwable><![CDATA[com.mojang.authlib.exceptions.InvalidCredentialsException: Status: 401
	at com.mojang.authlib.Foo.bar(Foo.java:1)
]]></log4j:Throwable>
</log4j:Event>`

describe('Log4jLineParser', () => {
  it('formats vanilla XML log events like the official launcher', () => {
    const parser = new Log4jLineParser()
    const out = sample.split('\n').flatMap((l) => parser.push(l))
    expect(out[0]).toEqual({ text: '[14:05:09] [Render thread/INFO]: Setting user: SmclTester', error: false })
    expect(out[1]).toEqual({ text: '[14:05:09] [Render thread/ERROR]: Failed to verify authentication', error: true })
    expect(out[2].text).toContain('InvalidCredentialsException')
    expect(out.slice(2).every((l) => l.error)).toBe(true)
    expect(out.some((l) => l.text.includes('<log4j'))).toBe(false)
  })

  it('passes plain lines through and flushes partial events', () => {
    const parser = new Log4jLineParser()
    expect(parser.push('[main] plain output')).toEqual([{ text: '[main] plain output', error: false }])
    expect(parser.push('<log4j:Event logger="x" level="INFO" thread="t">')).toEqual([])
    expect(parser.flush()).toHaveLength(1)
  })
})
