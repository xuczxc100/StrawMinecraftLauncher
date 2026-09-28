import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { SCREENSHOT_DIR, horizontalOverflow, launchApp } from './helpers'

const PAGES = ['home', 'instances', 'resources', 'modpacks', 'accounts', 'java', 'settings'] as const

test('every page renders without errors or horizontal overflow', async () => {
  const smcl = await launchApp()
  try {
    for (const name of PAGES) {
      await smcl.page.getByTestId(`nav-${name}`).click()
      await expect(smcl.page.getByTestId(`page-${name}`)).toBeVisible()
      await smcl.page.waitForTimeout(300)
      expect(await horizontalOverflow(smcl.page), `overflow on ${name}`).toEqual([])
      await smcl.page.screenshot({ path: join(SCREENSHOT_DIR, `empty-${name}.png`) })
    }
    await expect(smcl.page.getByTestId('settings-disclaimer')).toContainText('PCL')
    await expect(smcl.page.getByTestId('settings-about')).toContainText('@xmcl')
    expect(smcl.consoleErrors).toEqual([])
  } finally {
    await smcl.close()
  }
})
