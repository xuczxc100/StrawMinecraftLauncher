<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '../api'
import Icon from '../components/Icon.vue'
import ResourceBrowser from '../components/ResourceBrowser.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useI18n()
const importing = ref(false)

async function importFile() {
  const file = await invoke('dialog:openFile', [{ name: 'Modpack', extensions: ['mrpack', 'zip'] }])
  if (!file) return
  importing.value = true
  store.taskDrawerOpen = true
  try {
    const result = await invoke('modpack:importFile', file)
    store.notify(t('modpacks.imported', { name: result.instance.name }), 'success')
    if (result.skippedFiles.length) store.notify(t('modpacks.skipped', { count: result.skippedFiles.length }), 'info')
  } catch (e) {
    store.fail(e)
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="page" data-testid="page-modpacks">
    <div class="page-header"><h1>{{ t('modpacks.title') }}</h1></div>
    <section class="card import">
      <div class="icon-tile"><Icon name="package" /></div>
      <div class="grow">
        <h2>{{ t('modpacks.importFile') }}</h2>
        <p class="small muted">{{ t('modpacks.importHint') }}</p>
      </div>
      <button class="btn btn-primary" :disabled="importing" data-testid="modpack-import-file" @click="importFile">
        <Icon name="upload" :size="16" />{{ t('common.browse') }}
      </button>
    </section>
    <h2 class="section-title">{{ t('modpacks.browse') }}</h2>
    <ResourceBrowser fixed-kind="modpack" />
  </div>
</template>

<style scoped>
.import {
  display: flex;
  align-items: center;
  gap: 16px;
}

.section-title {
  margin: 24px 0 12px;
}
</style>
