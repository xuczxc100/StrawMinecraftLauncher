import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export const ROOT = resolve(import.meta.dirname, '../..')
export const SCREENSHOT_DIR = join(ROOT, 'test-results', 'screenshots')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  dataDir: string
  consoleErrors: string[]
  close: () => Promise<void>
}

const CACHE_ROOT = join(ROOT, '.smcl-test/integration')

export async function launchApp(options: { dataDir?: string; keep?: boolean; sharedCache?: boolean } = {}): Promise<LaunchedApp> {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'smcl-e2e-'))
  if (options.sharedCache) {
    // Reuse the integration-test game/Java cache so E2E launches do not re-download ~700 MB.
    for (const dir of ['minecraft', 'java']) {
      if (existsSync(join(CACHE_ROOT, dir)) && !existsSync(join(dataDir, dir))) symlinkSync(join(CACHE_ROOT, dir), join(dataDir, dir), 'dir')
    }
  }
  const args = [join(ROOT, 'out/main/index.js')]
  if (process.getuid?.() === 0 || process.env.CI) args.push('--no-sandbox')
  const app = await electron.launch({
    args,
    cwd: ROOT,
    env: {
      ...process.env,
      SMCL_DATA_DIR: dataDir,
      SMCL_ALLOW_MULTI: '1',
      SMCL_MS_CLIENT_ID: '',
      SMCL_CURSEFORGE_KEY: '',
      ELECTRON_RENDERER_URL: '',
    },
  })
  const page = await app.firstWindow()
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))
  await page.setViewportSize({ width: 1180, height: 740 })
  await page.waitForSelector('[data-testid="page-home"]')
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { __smclToasts: string[] }).__smclToasts = seen
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of Array.from(r.addedNodes))
          if (n instanceof HTMLElement && n.classList.contains('toast')) seen.push(`${n.className}: ${n.textContent?.trim()}`)
    }).observe(document.body, { childList: true, subtree: true })
  })
  return {
    app,
    page,
    dataDir,
    consoleErrors,
    close: async () => {
      await app.close()
      if (!options.keep && !options.dataDir) rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

export function toastHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __smclToasts?: string[] }).__smclToasts ?? [])
}

/** Fails when any element inside the main content overflows horizontally. */
export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const offenders: string[] = []
    const main = document.querySelector('main')
    if (!main) return offenders
    const limit = main.getBoundingClientRect().right + 1
    for (const el of Array.from(main.querySelectorAll<HTMLElement>('*'))) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.right > limit) {
        offenders.push(`${el.tagName.toLowerCase()}.${el.className} → ${Math.round(rect.right - limit)}px`)
      }
    }
    return offenders.slice(0, 10)
  })
}
