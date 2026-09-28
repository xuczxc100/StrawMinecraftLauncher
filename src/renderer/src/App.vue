<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './components/Icon.vue'
import TaskDrawer from './components/TaskDrawer.vue'
import { useAppStore } from './stores/app'

const store = useAppStore()
const { t } = useI18n()

const nav = [
  { to: '/', icon: 'home', key: 'home' },
  { to: '/instances', icon: 'cube', key: 'instances' },
  { to: '/resources', icon: 'puzzle', key: 'resources' },
  { to: '/modpacks', icon: 'package', key: 'modpacks' },
  { to: '/accounts', icon: 'user', key: 'accounts' },
  { to: '/java', icon: 'coffee', key: 'java' },
  { to: '/settings', icon: 'settings', key: 'settings' },
]

onMounted(() => {
  store.init().catch((e) => store.fail(e))
})
</script>

<template>
  <div class="shell">
    <nav class="sidebar" aria-label="main">
      <div class="brand">
        <img src="./assets/logo.svg" alt="" width="30" height="30" />
        <div>
          <strong>SMCL</strong>
          <span class="small faint">StrawMinecraftLauncher</span>
        </div>
      </div>
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :data-testid="`nav-${item.key}`"
        :class="{ exact: item.to === '/' }"
      >
        <Icon :name="item.icon" />
        <span>{{ t(`nav.${item.key}`) }}</span>
      </RouterLink>
      <div class="spacer" />
      <button class="nav-item task-button" data-testid="open-tasks" @click="store.taskDrawerOpen = !store.taskDrawerOpen">
        <Icon name="tasks" />
        <span class="grow">{{ t('tasks.title') }}</span>
        <span v-if="store.runningTasks.length" class="badge accent">{{ store.runningTasks.length }}</span>
      </button>
      <RouterLink to="/accounts" class="account-chip" data-testid="account-chip">
        <div class="avatar">{{ store.selectedAccount?.name.slice(0, 1).toUpperCase() ?? '?' }}</div>
        <div class="grow">
          <div class="truncate">{{ store.selectedAccount?.name ?? t('home.noAccount') }}</div>
          <div class="small faint">
            {{ store.selectedAccount ? t(`accounts.${store.selectedAccount.type}`) : t('home.addAccount') }}
          </div>
        </div>
      </RouterLink>
    </nav>
    <main class="content">
      <RouterView v-if="store.ready" />
      <div v-else class="empty">{{ t('common.loading') }}</div>
    </main>
    <TaskDrawer v-if="store.taskDrawerOpen" />
    <div class="toasts" aria-live="polite">
      <div v-for="toast in store.toasts" :key="toast.id" class="toast" :class="toast.kind" @click="store.dismiss(toast.id)">
        <Icon :name="toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : 'info'" :size="16" />
        <span>{{ toast.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  height: 100%;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 12px;
  background: var(--sidebar);
  border-right: 1px solid var(--border);
  min-height: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 18px;
}

.brand strong {
  display: block;
  font-size: 16px;
  letter-spacing: 0.04em;
}

.brand span {
  display: block;
  margin-top: -2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--muted);
  text-decoration: none;
  font-weight: 560;
  border: none;
  background: transparent;
  font: inherit;
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.nav-item.router-link-active:not(.exact),
.nav-item.exact.router-link-exact-active {
  background: var(--surface-2);
  color: var(--text);
  box-shadow: inset 3px 0 0 var(--accent);
}

.account-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  padding: 10px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  text-decoration: none;
  min-width: 0;
}

.content {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 60;
  max-width: 420px;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  cursor: pointer;
  word-break: break-word;
}

.toast.error {
  border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
  color: var(--danger);
}

.toast.success {
  border-color: color-mix(in srgb, var(--success) 60%, var(--border));
}
</style>
