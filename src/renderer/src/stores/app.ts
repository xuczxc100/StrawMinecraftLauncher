import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  Account,
  AppConfig,
  AppInfo,
  InstanceConfig,
  JavaInstall,
  LaunchLogLine,
  LaunchState,
  TaskInfo,
} from '@shared/types'
import { errorCode, errorText, invoke, on } from '../api'
import { i18n } from '../i18n'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

const MAX_LOG_LINES = 1500

/** Dark text on light accents, white text on dark accents (WCAG relative luminance). */
export function contrastText(hex: string): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return luminance > 0.35 ? '#1b1406' : '#ffffff'
}

export const useAppStore = defineStore('app', () => {
  const ready = ref(false)
  const info = ref<AppInfo>()
  const config = ref<AppConfig>()
  const accounts = ref<Account[]>([])
  const selectedAccountId = ref<string>()
  const instances = ref<InstanceConfig[]>([])
  const javas = ref<JavaInstall[]>([])
  const tasks = ref<TaskInfo[]>([])
  const launchStates = ref<Record<string, LaunchState>>({})
  const logs = ref<Record<string, LaunchLogLine[]>>({})
  const toasts = ref<Toast[]>([])
  const taskDrawerOpen = ref(false)
  let toastSeq = 0

  const selectedInstance = computed(() => {
    const id = config.value?.selectedInstanceId
    return instances.value.find((i) => i.id === id) ?? instances.value[0]
  })
  const selectedAccount = computed(() => accounts.value.find((a) => a.id === selectedAccountId.value))
  const runningTasks = computed(() => tasks.value.filter((t) => t.status === 'running'))

  function notify(text: string, kind: Toast['kind'] = 'info') {
    const id = ++toastSeq
    toasts.value.push({ id, kind, text })
    setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000)
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function describeError(e: unknown): string {
    const code = errorCode(e)
    const key = `errors.${code}`
    return code && i18n.global.te(key) ? i18n.global.t(key) : errorText(e)
  }

  function fail(e: unknown) {
    if (errorCode(e) === 'Cancelled') return
    notify(describeError(e), 'error')
  }

  function applyConfig(next: AppConfig) {
    config.value = next
    i18n.global.locale.value = next.locale
    const root = document.documentElement
    root.dataset.theme = next.theme
    root.style.setProperty('--accent', next.accentColor)
    root.style.setProperty('--accent-contrast', contrastText(next.accentColor))
    root.lang = next.locale === 'en' ? 'en' : 'zh-Hant'
  }

  function upsertTask(task: TaskInfo) {
    const index = tasks.value.findIndex((t) => t.id === task.id)
    if (index >= 0) tasks.value.splice(index, 1, task)
    else tasks.value.unshift(task)
  }

  async function init() {
    on('config:changed', applyConfig)
    on('accounts:changed', ({ accounts: list, selectedId }) => {
      accounts.value = list
      selectedAccountId.value = selectedId
    })
    on('instances:changed', (list) => (instances.value = list))
    on('task:update', upsertTask)
    on('launch:state', (state) => (launchStates.value = { ...launchStates.value, [state.instanceId]: state }))
    on('launch:log', (line) => {
      const list = logs.value[line.instanceId] ?? (logs.value[line.instanceId] = [])
      list.push(line)
      if (list.length > MAX_LOG_LINES) list.splice(0, list.length - MAX_LOG_LINES)
    })
    const [appInfo, cfg, acc, inst, javaList, taskList, states] = await Promise.all([
      invoke('app:info'),
      invoke('config:get'),
      invoke('account:list'),
      invoke('instance:list'),
      invoke('java:list'),
      invoke('task:list'),
      invoke('launch:states'),
    ])
    info.value = appInfo
    applyConfig(cfg)
    accounts.value = acc.accounts
    selectedAccountId.value = acc.selectedId
    instances.value = inst
    javas.value = javaList
    tasks.value = taskList
    launchStates.value = Object.fromEntries(states.map((s) => [s.instanceId, s]))
    ready.value = true
  }

  async function refreshInfo() {
    info.value = await invoke('app:info')
  }

  async function updateConfig(patch: Partial<AppConfig>) {
    applyConfig(await invoke('config:set', patch))
    await refreshInfo()
  }

  async function selectInstance(id: string) {
    await invoke('instance:select', id)
  }

  async function selectAccount(id: string) {
    await invoke('account:select', id)
  }

  async function launch(id: string) {
    logs.value = { ...logs.value, [id]: [] }
    try {
      await invoke('launch:start', id)
    } catch (e) {
      fail(e)
    }
  }

  return {
    ready,
    info,
    config,
    accounts,
    selectedAccountId,
    instances,
    javas,
    tasks,
    launchStates,
    logs,
    toasts,
    taskDrawerOpen,
    selectedInstance,
    selectedAccount,
    runningTasks,
    init,
    notify,
    dismiss,
    fail,
    describeError,
    refreshInfo,
    updateConfig,
    selectInstance,
    selectAccount,
    launch,
  }
})
