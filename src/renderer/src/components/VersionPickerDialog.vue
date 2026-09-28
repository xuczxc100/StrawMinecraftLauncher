<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LoaderType, ResourceKind, ResourceSource, ResourceVersion } from '@shared/types'
import { errorText, invoke } from '../api'
import { formatBytes, formatDate } from '../format'
import Modal from './Modal.vue'

const props = defineProps<{
  title: string
  source: ResourceSource
  projectId: string
  kind: ResourceKind
  gameVersion?: string
  loader?: LoaderType
}>()
const emit = defineEmits<{ close: []; pick: [version: ResourceVersion] }>()
const { t } = useI18n()

const versions = ref<ResourceVersion[]>([])
const loading = ref(true)
const error = ref<string>()

onMounted(async () => {
  try {
    versions.value = await invoke('resource:versions', props.source, props.projectId, props.kind, {
      gameVersion: props.gameVersion,
      loader: props.loader,
    })
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
})

function primarySize(v: ResourceVersion) {
  return (v.files.find((f) => f.primary) ?? v.files[0])?.size ?? 0
}
</script>

<template>
  <Modal :title="`${t('resources.chooseVersion')} — ${title}`" :width="680" @close="emit('close')">
    <div v-if="loading" class="empty">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="notice warn">{{ error }}</div>
    <div v-else-if="!versions.length" class="empty">
      {{ t('resources.noVersions', { mc: gameVersion ?? '', loader: loader ? t(`loader.${loader}`) : '' }) }}
    </div>
    <div v-else class="list" data-testid="version-list">
      <div v-for="v in versions" :key="v.versionId" class="list-item">
        <div class="grow">
          <div class="row">
            <strong class="truncate">{{ v.name || v.versionNumber }}</strong>
            <span class="badge" :class="{ success: v.releaseType === 'release', danger: v.releaseType === 'alpha' }">{{ v.releaseType }}</span>
          </div>
          <div class="small faint truncate">
            {{ v.versionNumber }} · {{ v.loaders.join(', ') || '—' }} · {{ v.gameVersions.slice(0, 6).join(', ') }}{{ v.gameVersions.length > 6 ? '…' : '' }}
          </div>
          <div class="small faint">{{ formatDate(v.published) }} · {{ formatBytes(primarySize(v)) }}</div>
        </div>
        <button class="btn btn-sm btn-primary" @click="emit('pick', v)">{{ t('common.install') }}</button>
      </div>
    </div>
  </Modal>
</template>
