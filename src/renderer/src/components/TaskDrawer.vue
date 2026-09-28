<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { invoke } from '../api'
import { formatBytes, percent } from '../format'
import { useAppStore } from '../stores/app'
import Icon from './Icon.vue'

const store = useAppStore()
const { t } = useI18n()

async function clear() {
  await invoke('task:clearFinished')
  store.tasks = store.tasks.filter((task) => task.status === 'running')
}

function progressText(task: (typeof store.tasks)[number]) {
  if (task.unit === 'bytes' && task.total) return `${formatBytes(task.progress)} / ${formatBytes(task.total)}`
  if (task.unit === 'items' && task.total) return `${task.progress} / ${task.total}`
  return ''
}
</script>

<template>
  <aside class="drawer" data-testid="task-drawer">
    <header>
      <h2>{{ t('tasks.title') }}</h2>
      <div class="row">
        <button class="btn btn-sm btn-ghost" @click="clear">{{ t('tasks.clear') }}</button>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="store.taskDrawerOpen = false">
          <Icon name="close" />
        </button>
      </div>
    </header>
    <div v-if="store.tasks.length === 0" class="empty">{{ t('tasks.empty') }}</div>
    <ul v-else>
      <li v-for="task in store.tasks" :key="task.id" :data-status="task.status">
        <div class="row">
          <strong class="grow truncate">{{ task.title }}</strong>
          <span
            class="badge"
            :class="{ success: task.status === 'success', danger: task.status === 'failed', accent: task.status === 'running' }"
          >
            {{ t(`tasks.status.${task.status}`) }}
          </span>
        </div>
        <p v-if="task.detail" class="small muted truncate">{{ task.detail }}</p>
        <template v-if="task.status === 'running'">
          <div class="progress" :class="{ indeterminate: !task.total }">
            <div :style="{ width: `${percent(task.progress, task.total)}%` }" />
          </div>
          <div class="row small faint">
            <span class="grow">{{ progressText(task) }}</span>
            <button class="btn btn-sm btn-ghost" @click="invoke('task:cancel', task.id)">{{ t('tasks.cancel') }}</button>
          </div>
        </template>
        <p v-if="task.error" class="small error">{{ task.error }}</p>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  z-index: 40;
  display: flex;
  flex-direction: column;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 12px 12px 18px;
  border-bottom: 1px solid var(--border);
}

ul {
  list-style: none;
  margin: 0;
  padding: 8px 12px;
  overflow-y: auto;
}

li {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 8px;
  border-bottom: 1px solid var(--border);
}

.error {
  color: var(--danger);
  word-break: break-word;
}
</style>
