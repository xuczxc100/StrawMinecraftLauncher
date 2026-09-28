<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import type { ResourceKind } from '@shared/types'
import ResourceBrowser from '../components/ResourceBrowser.vue'

const route = useRoute()
const { t } = useI18n()
const KINDS: ResourceKind[] = ['mod', 'resourcepack', 'shader', 'modpack']

const initialKind = computed(() => {
  const kind = route.query.kind
  return typeof kind === 'string' && (KINDS as string[]).includes(kind) ? (kind as ResourceKind) : undefined
})
const initialInstance = computed(() => (typeof route.query.instance === 'string' ? route.query.instance : undefined))
</script>

<template>
  <div class="page" data-testid="page-resources">
    <div class="page-header"><h1>{{ t('resources.title') }}</h1></div>
    <ResourceBrowser :key="route.fullPath" :initial-kind="initialKind" :initial-instance="initialInstance" />
  </div>
</template>
