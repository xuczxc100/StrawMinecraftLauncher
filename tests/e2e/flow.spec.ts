import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { SCREENSHOT_DIR, horizontalOverflow, launchApp, toastHistory, type LaunchedApp } from './helpers'

const shot = (page: Page, name: string) => page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) })

async function expectNoOverflow(page: Page, where: string) {
  expect(await horizontalOverflow(page), `horizontal overflow on ${where}`).toEqual([])
}

async function setTasksOpen(page: Page, open: boolean) {
  const drawer = page.getByTestId('task-drawer')
  if ((await drawer.isVisible()) !== open) await page.getByTestId('open-tasks').click()
  await expect(drawer).toBeVisible({ visible: open })
}

/** Opens the task drawer, waits for every task to finish without failures, then closes it. */
async function waitTasksIdle(page: Page, timeout = 600_000) {
  await setTasksOpen(page, true)
  const drawer = page.getByTestId('task-drawer')
  await expect(drawer.locator('li[data-status="running"]')).toHaveCount(0, { timeout })
  await expect(drawer.locator('li[data-status="failed"]')).toHaveCount(0)
  await setTasksOpen(page, false)
}

async function createInstance(page: Page, name: string, loader: 'vanilla' | 'fabric') {
  const dialog = page.getByTestId('create-instance-dialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('instance-mc').selectOption('1.20.1')
  await page.getByTestId(`loader-${loader}`).click()
  if (loader !== 'vanilla') await expect(page.getByTestId('instance-loader-version')).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('instance-name').fill(name)
  await shot(page, `create-${loader}-dialog`)
  await page.getByTestId('create-instance-submit').click()
  await expect(dialog).toBeHidden()
}

test.describe.configure({ mode: 'serial' })

test('full user flow: instances, accounts, Modrinth, launch, export and import', async () => {
  test.setTimeout(1_200_000)
  const smcl: LaunchedApp = await launchApp({ sharedCache: true })
  const { page, app } = smcl
  try {
    // --- create a vanilla instance from the empty home page
    await page.getByTestId('home-create-instance').click()
    await createInstance(page, 'E2E Vanilla', 'vanilla')
    await expect(page.getByTestId('home-instance-name')).toHaveText('E2E Vanilla')
    await setTasksOpen(page, true)
    await shot(page, 'task-drawer-installing')
    await expect(page.getByTestId('task-drawer').locator('li[data-status="running"]')).toHaveCount(0, { timeout: 600_000 })
    await shot(page, 'task-drawer-done')
    await waitTasksIdle(page)

    // --- offline account; Microsoft login disabled without a client id
    await page.getByTestId('nav-accounts').click()
    await expect(page.getByTestId('ms-not-configured')).toBeVisible()
    await expect(page.getByTestId('add-microsoft')).toBeDisabled()
    await page.getByTestId('offline-name').fill('E2E_Player')
    await page.getByTestId('add-offline').click()
    await expect(page.getByTestId('account-list')).toContainText('E2E_Player')
    await expect(page.getByTestId('account-chip')).toContainText('E2E_Player')
    await expectNoOverflow(page, 'accounts')
    await shot(page, 'accounts')

    // --- Fabric instance from the instances page lands on its detail page
    await page.getByTestId('nav-instances').click()
    await page.getByTestId('create-instance').click()
    await createInstance(page, 'E2E Fabric', 'fabric')
    await expect(page.getByTestId('detail-title')).toHaveText('E2E Fabric')
    await expectNoOverflow(page, 'instance detail')
    await shot(page, 'instance-detail-settings')
    await waitTasksIdle(page)

    // --- Modrinth search and install into the Fabric instance
    await page.getByTestId('nav-resources').click()
    await page.getByTestId('resource-target').selectOption({ label: 'E2E Fabric（1.20.1 Fabric）' })
    await page.getByTestId('resource-query').fill('fabric api')
    await expect(page.getByTestId('install-fabric-api')).toBeVisible({ timeout: 60_000 })
    await expectNoOverflow(page, 'resources')
    await shot(page, 'resources-modrinth')
    await page.getByTestId('install-fabric-api').click()
    await expect(page.locator('.toast.success', { hasText: /已安裝 \d+ 個檔案/ })).toBeVisible({ timeout: 180_000 })

    await page.getByTestId('source-curseforge').click()
    await expect(page.getByTestId('curseforge-missing')).toBeVisible()
    await shot(page, 'resources-curseforge-missing')
    await page.getByTestId('source-modrinth').click()

    await page.getByTestId('nav-instances').click()
    await page.getByTestId('instance-list').getByText('E2E Fabric').click()
    await page.getByTestId('tab-mods').click()
    await expect(page.getByTestId('local-mod')).toContainText('Fabric API', { timeout: 30_000 })
    await expectNoOverflow(page, 'instance mods')
    await shot(page, 'instance-mods')

    // --- export the Fabric instance to .mrpack (native save dialog stubbed)
    const mrpack = join(smcl.dataDir, 'e2e-export.mrpack')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, mrpack)
    await page.getByTestId('tab-export').click()
    await shot(page, 'instance-export')
    await page.getByTestId('export-run').click()
    await expect(page.locator('.toast.success', { hasText: 'e2e-export.mrpack' })).toBeVisible({ timeout: 120_000 })
    expect(existsSync(mrpack)).toBe(true)

    // --- import it back as a new instance
    await page.getByTestId('nav-modpacks').click()
    await page.getByTestId('modpack-import-file').click()
    await expect(page.locator('.toast.success', { hasText: '已匯入' })).toBeVisible({ timeout: 600_000 })
    await waitTasksIdle(page)
    await expectNoOverflow(page, 'modpacks')
    await shot(page, 'modpacks')
    await page.getByTestId('nav-instances').click()
    await expect(page.getByTestId('instance-list').locator('.list-item')).toHaveCount(3)
    await shot(page, 'instances-list')

    // --- theme + language switch
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('theme-light').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await shot(page, 'settings-light')
    await page.getByTestId('settings-locale').selectOption('en')
    await expect(page.getByTestId('nav-home')).toHaveText('Home')
    await shot(page, 'settings-en-light')
    await page.getByTestId('settings-locale').selectOption('zh-TW')
    await page.getByTestId('theme-dark').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // --- launch vanilla with the offline account and watch the log
    await page.getByTestId('nav-home').click()
    const vanillaId = await page.evaluate(async () => (await window.smcl.invoke('instance:list')).find((i) => i.name === 'E2E Vanilla')!.id)
    await page.getByTestId('home-instance-select').selectOption(vanillaId)
    await page.getByTestId('launch-button').click()
    await expect(page.getByTestId('kill-button')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('log-view')).toContainText('Setting user: E2E_Player', { timeout: 240_000 })
    await expect(page.getByTestId('log-view')).toContainText('LWJGL', { timeout: 60_000 })
    await expectNoOverflow(page, 'home running')
    await shot(page, 'home-running')
    await page.getByTestId('kill-button').click()
    await expect(page.getByTestId('launch-button')).toBeEnabled({ timeout: 30_000 })
    await expect(page.getByTestId('launch-failed')).toHaveCount(0)
    await shot(page, 'home-exited')

    expect(smcl.consoleErrors).toEqual([])
  } catch (e) {
    console.log('TOASTS', JSON.stringify(await toastHistory(page).catch(() => []), null, 1))
    console.log('CONSOLE', JSON.stringify(smcl.consoleErrors, null, 1))
    throw e
  } finally {
    await smcl.close()
  }
})
