export interface FormattedLogLine {
  text: string
  error: boolean
}

const ATTR = /(\w+)="([^"]*)"/g
const MESSAGE = /<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Message>/
const THROWABLE = /<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Throwable>/

function time(ms: number) {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

/**
 * Minecraft's vanilla logging config (client-1.12.xml) prints log4j XML events on stdout.
 * This turns them into the familiar `[12:00:00] [Render thread/INFO]: message` lines; other output passes through.
 */
export class Log4jLineParser {
  private buffer: string[] | undefined

  push(line: string): FormattedLogLine[] {
    if (!this.buffer) {
      if (!line.trimStart().startsWith('<log4j:Event')) return [{ text: line, error: false }]
      this.buffer = []
    }
    this.buffer.push(line)
    if (!line.includes('</log4j:Event>')) return []
    const xml = this.buffer.join('\n')
    this.buffer = undefined
    return formatEvent(xml)
  }

  /** Emit anything left over (e.g. the process died mid-event). */
  flush(): FormattedLogLine[] {
    const rest = this.buffer ?? []
    this.buffer = undefined
    return rest.map((text) => ({ text, error: false }))
  }
}

function formatEvent(xml: string): FormattedLogLine[] {
  const head = xml.slice(0, xml.indexOf('>'))
  const attrs = Object.fromEntries([...head.matchAll(ATTR)].map((m) => [m[1], m[2]]))
  const level = attrs.level ?? 'INFO'
  const error = level === 'ERROR' || level === 'FATAL'
  const prefix = `[${time(Number(attrs.timestamp) || Date.now())}] [${attrs.thread ?? 'main'}/${level}]: `
  const message = MESSAGE.exec(xml)?.[1] ?? ''
  const lines = message.split('\n').map((text, i) => ({ text: i === 0 ? prefix + text : text, error }))
  const throwable = THROWABLE.exec(xml)?.[1]
  if (throwable) lines.push(...throwable.split('\n').map((text) => ({ text, error: true })))
  return lines
}
