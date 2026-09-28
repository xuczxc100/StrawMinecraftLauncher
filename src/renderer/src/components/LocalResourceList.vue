<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { LocalResourceKind } from '@shared/ipc'
import type { LocalResource } from '@shared/types'
import { invoke } from '../api'
import { formatBytes } from '../format'
import { useAppStore } from '../stores/app'
import Icon from './Icon.vue'

const props = defineProps<{ instanceId: string; kind: LocalResourceKind }>()
const store = useAppStore()
const router = useRouter()
const { t } = useI18n()
const items = ref<LocalResource[]>([])
const loading = ref(false)

const FOLDERS: Record<LocalResourceKind, string> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }

async function load() {
  loading.value = true
  try {
    items.value = await invoke('resource:listLocal', props.instanceId, props.kind)
  } catch (e) {
    store.fail(e)
  } finally {
    loading.value = false
  }
}

async function toggle(item: LocalResource) {
  try {
    items.value = await invoke('resource:toggle', props.instanceId, props.kind, item.fileName, !item.enabled)
  } catch (e) {
    store.fail(e)
  }
}

async function remove(item: LocalResource) {
  if (!confirm(t('instances.local.deleteConfirm', { name: item.name ?? item.fileName }))) return
  try {
    items.value = await invoke('resource:delete', props.instanceId, props.kind, item.fileName)
  } catch (e) {
    store.fail(e)
  }
}

function browse() {
  router.push({ path: '/resources', query: { kind: props.kind, instance: props.instanceId } })
}

watch(() => [props.instanceId, props.kind], load)
watch(
  () => store.runningTasks.length,
  (now, before) => {
    if (now < before) void load()
  },
)
onMounted(load)
</script>

<template>
  <div class="stack" :data-testid="`local-${kind}`">
    <div class="row">
      <span class="grow small muted">{{ items.length }} · {{ FOLDERS[kind] }}/</span>
      <button class="btn btn-sm" @click="load"><Icon name="refresh" :size="15" />{{ t('common.refresh') }}</button>
      <button class="btn btn-sm" @click="invoke('instance:openFolder', instanceId, FOLDERS[kind]).catch(store.fail)">
        <Icon name="folder" :size="15" />{{ t('common.openFolder') }}
      </button>
      <button class="btn btn-sm btn-primary" @click="browse"><Icon name="download" :size="15" />{{ t('instances.local.browse') }}</button>
    </div>
    <div v-if="loading && !items.length" class="empty">{{ t('common.loading') }}</div>
    <div v-else-if="!items.length" class="empty">{{ t('instances.local.empty') }}</div>
    <div v-else class="list">
      <div v-for="item in items" :key="item.fileName" class="list-item" :class="{ off: !item.enabled }">
        <label class="check" :title="item.enabled ? t('common.enabled') : t('common.disabled')">
          <input type="checkbox" :checked="item.enabled" @change="toggle(item)" />
        </label>
        <div class="grow">
          <div class="row">
            <strong class="truncate">{{ item.name ?? item.fileName }}</strong>
            <span v-if="item.version" class="badge">{{ item.version }}</span>
            <span v-if="item.origin" class="badge accent">{{ item.origin.source === 'modrinth' ? 'Modrinth' : 'CurseForge' }}</span>
          </div>
          <div class="small faint truncate">{{ item.description || item.fileName }}</div>
        </div>
        <span class="small faint">{{ formatBytes(item.size) }}</span>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.delete')" @click="remove(item)">
          <Icon name="trash" :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.off strong,
.off .small {
  opacity: 0.55;
}
</style>
