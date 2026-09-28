<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LOADER_TYPES, type InstanceConfig, type LoaderType } from '@shared/types'
import { errorText, invoke } from '../api'
import { useMinecraftVersions } from '../composables/versions'
import { useAppStore } from '../stores/app'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: []; created: [instance: InstanceConfig] }>()
const store = useAppStore()
const { t } = useI18n()
const versions = useMinecraftVersions()

const name = ref('')
const nameTouched = ref(false)
const minecraft = ref('')
const loader = ref<LoaderType>('vanilla')
const loaderVersion = ref('')
const loaderVersions = ref<string[]>([])
const loaderLoading = ref(false)
const loaderError = ref<string>()
const showSnapshots = ref(false)
const creating = ref(false)

const options = computed(() =>
  (versions.list.value?.versions ?? []).filter((v) => v.type === 'release' || (showSnapshots.value && v.type === 'snapshot')),
)

const autoName = computed(() => `${minecraft.value}${loader.value === 'vanilla' ? '' : ` ${t(`loader.${loader.value}`)}`}`)
watch(autoName, (value) => {
  if (!nameTouched.value) name.value = value
})

watch(
  () => versions.list.value,
  (list) => {
    if (list && !minecraft.value) minecraft.value = list.latest.release
  },
  { immediate: true },
)

let loaderRequest = 0
watch([minecraft, loader], async ([mc, type]) => {
  loaderVersions.value = []
  loaderVersion.value = ''
  loaderError.value = undefined
  if (!mc || type === 'vanilla') return
  const req = ++loaderRequest
  loaderLoading.value = true
  try {
    const list = await invoke('version:listLoaders', type, mc)
    if (req !== loaderRequest) return
    loaderVersions.value = list
    loaderVersion.value = list[0] ?? ''
  } catch (e) {
    if (req === loaderRequest) loaderError.value = errorText(e)
  } finally {
    if (req === loaderRequest) loaderLoading.value = false
  }
})

const canCreate = computed(
  () => name.value.trim() && minecraft.value && (loader.value === 'vanilla' || loaderVersion.value) && !creating.value,
)

async function create() {
  creating.value = true
  try {
    const instance = await invoke('instance:create', {
      name: name.value.trim(),
      minecraft: minecraft.value,
      loader: loader.value,
      loaderVersion: loader.value === 'vanilla' ? undefined : loaderVersion.value,
    })
    await store.selectInstance(instance.id)
    invoke('install:instance', instance.id).catch((e) => store.fail(e))
    emit('created', instance)
  } catch (e) {
    store.fail(e)
  } finally {
    creating.value = false
  }
}

onMounted(() => versions.load())
</script>

<template>
  <Modal :title="t('instances.create')" :width="560" @close="emit('close')">
    <div class="stack" data-testid="create-instance-dialog">
      <div class="field">
        <label for="inst-name">{{ t('instances.name') }}</label>
        <input id="inst-name" v-model="name" class="input" data-testid="instance-name" @input="nameTouched = true" />
      </div>
      <div class="field">
        <div class="row">
          <label class="field-label grow" for="inst-mc">{{ t('instances.minecraft') }}</label>
          <label class="check small"><input v-model="showSnapshots" type="checkbox" />{{ t('instances.showSnapshots') }}</label>
        </div>
        <p v-if="versions.loading.value" class="small muted">{{ t('instances.loadingVersions') }}</p>
        <p v-else-if="versions.error.value" class="small text-danger">
          {{ t('instances.versionListFailed', { error: versions.error.value }) }}
          <button class="btn btn-sm" @click="versions.load(true)">{{ t('common.retry') }}</button>
        </p>
        <select v-else id="inst-mc" v-model="minecraft" class="select" data-testid="instance-mc">
          <option v-for="v in options" :key="v.id" :value="v.id">{{ v.id }}{{ v.type === 'snapshot' ? ' (snapshot)' : '' }}</option>
        </select>
      </div>
      <div class="field">
        <span class="field-label">{{ t('instances.loader') }}</span>
        <div class="segmented" role="radiogroup">
          <button
            v-for="type in LOADER_TYPES"
            :key="type"
            type="button"
            :class="{ active: loader === type }"
            :data-testid="`loader-${type}`"
            @click="loader = type"
          >
            {{ t(`loader.${type}`) }}
          </button>
        </div>
      </div>
      <div v-if="loader !== 'vanilla'" class="field">
        <label for="inst-loader-version">{{ t('instances.loaderVersion') }}</label>
        <p v-if="loaderLoading" class="small muted">{{ t('instances.loadingVersions') }}</p>
        <p v-else-if="loaderError" class="small text-danger">{{ t('instances.versionListFailed', { error: loaderError }) }}</p>
        <p v-else-if="!loaderVersions.length" class="small muted">{{ t('instances.noLoaderVersions', { loader: t(`loader.${loader}`) }) }}</p>
        <select v-else id="inst-loader-version" v-model="loaderVersion" class="select" data-testid="instance-loader-version">
          <option v-for="v in loaderVersions" :key="v" :value="v">{{ v }}</option>
        </select>
      </div>
    </div>
    <template #footer>
      <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="!canCreate" data-testid="create-instance-submit" @click="create">
        {{ t('common.create') }}
      </button>
    </template>
  </Modal>
</template>
