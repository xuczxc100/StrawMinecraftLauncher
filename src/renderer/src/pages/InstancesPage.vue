<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { InstanceConfig } from '@shared/types'
import CreateInstanceDialog from '../components/CreateInstanceDialog.vue'
import Icon from '../components/Icon.vue'
import { formatDate } from '../format'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const router = useRouter()
const { t } = useI18n()
const creating = ref(false)

function open(id: string) {
  router.push(`/instances/${encodeURIComponent(id)}`)
}

function created(instance: InstanceConfig) {
  creating.value = false
  open(instance.id)
}
</script>

<template>
  <div class="page" data-testid="page-instances">
    <div class="page-header">
      <h1>{{ t('instances.title') }}</h1>
      <button class="btn btn-primary" data-testid="create-instance" @click="creating = true">
        <Icon name="plus" />{{ t('instances.create') }}
      </button>
    </div>
    <div v-if="!store.instances.length" class="card empty">{{ t('instances.empty') }}</div>
    <div v-else class="list" data-testid="instance-list">
      <div
        v-for="item in store.instances"
        :key="item.id"
        class="list-item clickable"
        :data-testid="`instance-${item.id}`"
        @click="open(item.id)"
      >
        <div class="icon-tile"><Icon name="cube" /></div>
        <div class="grow">
          <div class="row">
            <strong class="truncate">{{ item.name }}</strong>
            <span v-if="item.id === store.selectedInstance?.id" class="badge accent">{{ t('accounts.current') }}</span>
          </div>
          <div class="small faint truncate">
            {{ item.minecraft }} ·
            {{ item.loader === 'vanilla' ? t('loader.vanilla') : `${t(`loader.${item.loader}`)} ${item.loaderVersion ?? ''}` }}
            · {{ t('home.lastPlayed') }}：{{ item.lastPlayed ? formatDate(item.lastPlayed) : t('home.neverPlayed') }}
          </div>
        </div>
        <span class="badge" :class="{ success: item.versionId }">
          {{ item.versionId ? t('instances.installed') : t('instances.notInstalled') }}
        </span>
        <Icon name="chevronLeft" class="chevron" />
      </div>
    </div>
    <CreateInstanceDialog v-if="creating" @close="creating = false" @created="created" />
  </div>
</template>

<style scoped>
.chevron {
  transform: rotate(180deg);
  color: var(--faint);
  flex-shrink: 0;
}
</style>
