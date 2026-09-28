export class SmclError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'SmclError'
  }
}

export function toErrorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof SmclError) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return { code: typeof code === 'string' ? code : error.name || 'Error', message: error.message }
  }
  return { code: 'Unknown', message: String(error) }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
