import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { ROOT, SCREENSHOT_DIR } from './helpers'

const executable = process.env.SMCL_PACKAGED

test.skip(!executable, 'set SMCL_PACKAGED to a packaged SMCL executable (AppImage, linux-unpacked/smcl, ...)')

test('packaged build starts and reaches XMCL-backed services', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'smcl-packaged-'))
  const app = await electron.launch({
    executablePath: executable!,
    args: process.getuid?.() === 0 || process.env.CI ? ['--no-sandbox'] : [],
    env: { ...process.env, SMCL_DATA_DIR: dataDir, SMCL_ALLOW_MULTI: '1', APPIMAGE_EXTRACT_AND_RUN: '1' },
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.setViewportSize({ width: 1180, height: 740 })
    await expect(page.getByTestId('page-home')).toBeVisible()

    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)

    const semver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('settings-about')).toContainText(semver)

    await page.getByTestId('nav-resources').click()
    await page.getByTestId('resource-query').fill('sodium')
    await expect(page.getByTestId('resource-results').locator('[data-testid^="install-"]').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('nav-java').click()
    await page.getByTestId('java-scan').click()
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'packaged-java.png') })

    await page.getByTestId('nav-instances').click()
    await page.getByTestId('create-instance').click()
    await expect(page.getByTestId('instance-mc').locator('option').first()).toBeAttached({ timeout: 30_000 })
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'packaged-create-instance.png') })

    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
