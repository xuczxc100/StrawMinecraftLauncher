<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { LOADER_TYPES, type InstanceConfig, type LoaderType } from '@shared/types'
import { errorText, invoke } from '../api'
import Icon from '../components/Icon.vue'
import LocalResourceList from '../components/LocalResourceList.vue'
import { useMinecraftVersions } from '../composables/versions'
import { useAppStore } from '../stores/app'

const props = defineProps<{ id: string }>()
const store = useAppStore()
const router = useRouter()
const { t } = useI18n()
const versions = useMinecraftVersions()

type Tab = 'settings' | 'mods' | 'resourcepacks' | 'shaders' | 'export'
const TABS: Tab[] = ['settings', 'mods', 'resourcepacks', 'shaders', 'export']
const tab = ref<Tab>('settings')

const instance = computed(() => store.instances.find((i) => i.id === props.id))

const form = reactive({
  name: '',
  minecraft: '',
  loader: 'vanilla' as LoaderType,
  loaderVersion: '',
  javaPath: '',
  minMemory: 0,
  maxMemory: 0,
  jvmArgs: '',
  mcArgs: '',
  width: 0,
  height: 0,
  fullscreen: false,
  serverHost: '',
  serverPort: 0,
})
const loaderVersions = ref<string[]>([])
const loaderError = ref<string>()
const saving = ref(false)

function reset(value: InstanceConfig) {
  Object.assign(form, {
    name: value.name,
    minecraft: value.minecraft,
    loader: value.loader,
    loaderVersion: value.loaderVersion ?? '',
    javaPath: value.javaPath ?? '',
    minMemory: value.minMemory ?? 0,
    maxMemory: value.maxMemory ?? 0,
    jvmArgs: value.jvmArgs ?? '',
    mcArgs: value.mcArgs ?? '',
    width: value.resolution?.width ?? 0,
    height: value.resolution?.height ?? 0,
    fullscreen: value.resolution?.fullscreen ?? false,
    serverHost: value.server?.host ?? '',
    serverPort: value.server?.port ?? 0,
  })
}

watch(
  () => props.id,
  () => {
    if (instance.value) reset(instance.value)
  },
  { immediate: true },
)

const versionChanged = computed(
  () =>
    !!instance.value &&
    (form.minecraft !== instance.value.minecraft ||
      form.loader !== instance.value.loader ||
      (form.loader !== 'vanilla' && form.loaderVersion !== (instance.value.loaderVersion ?? ''))),
)

let loaderRequest = 0
watch(
  () => [form.minecraft, form.loader] as const,
  async ([mc, loader]) => {
    loaderError.value = undefined
    loaderVersions.value = []
    if (!mc || loader === 'vanilla') return
    const req = ++loaderRequest
    try {
      const list = await invoke('version:listLoaders', loader, mc)
      if (req !== loaderRequest) return
      loaderVersions.value = list
      if (!list.includes(form.loaderVersion)) form.loaderVersion = list[0] ?? ''
    } catch (e) {
      if (req === loaderRequest) loaderError.value = errorText(e)
    }
  },
  { immediate: true },
)

const mcOptions = computed(() => {
  const list = versions.list.value?.versions ?? []
  const current = instance.value?.minecraft
  const releases = list.filter((v) => v.type === 'release' || v.id === current)
  return current && !releases.some((v) => v.id === current) ? [{ id: current, type: 'custom', releaseTime: '' }, ...releases] : releases
})

const positive = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : undefined)

async function save() {
  if (!instance.value) return
  if (form.loader !== 'vanilla' && !form.loaderVersion) {
    store.notify(t('instances.noLoaderVersions', { loader: t(`loader.${form.loader}`) }), 'error')
    return
  }
  saving.value = true
  try {
    const width = positive(form.width)
    const height = positive(form.height)
    await invoke('instance:update', instance.value.id, {
      name: form.name.trim() || instance.value.name,
      minecraft: form.minecraft,
      loader: form.loader,
      loaderVersion: form.loader === 'vanilla' ? undefined : form.loaderVersion,
      javaPath: form.javaPath || undefined,
      minMemory: positive(form.minMemory),
      maxMemory: positive(form.maxMemory),
      jvmArgs: form.jvmArgs.trim() || undefined,
      mcArgs: form.mcArgs.trim() || undefined,
      resolution: width || height || form.fullscreen ? { width: width ?? 854, height: height ?? 480, fullscreen: form.fullscreen } : undefined,
      server: form.serverHost.trim() ? { host: form.serverHost.trim(), port: positive(form.serverPort) } : undefined,
    })
    store.notify(t('common.saved'), 'success')
  } catch (e) {
    store.fail(e)
  } finally {
    saving.value = false
  }
}

async function installNow() {
  if (!instance.value) return
  store.taskDrawerOpen = true
  try {
    await invoke('install:instance', instance.value.id)
  } catch (e) {
    store.fail(e)
  }
}

async function remove() {
  if (!instance.value) return
  if (!confirm(t('instances.deleteConfirm', { name: instance.value.name }))) return
  try {
    await invoke('instance:delete', instance.value.id)
    store.notify(t('instances.deleted'), 'success')
    router.push('/instances')
  } catch (e) {
    store.fail(e)
  }
}

async function playThis() {
  if (!instance.value) return
  await store.selectInstance(instance.value.id)
  router.push('/')
}

// ---------- export ----------
const exportForm = reactive({ name: '', version: '1.0.0', summary: '' })
const EXPORT_ENTRIES = ['mods', 'resourcepacks', 'shaderpacks', 'config', 'options.txt', 'servers.dat']
const include = ref<string[]>(['mods', 'resourcepacks', 'shaderpacks', 'config'])
const exporting = ref(false)

watch(
  instance,
  (value) => {
    if (value && !exportForm.name) exportForm.name = value.name
  },
  { immediate: true },
)

async function runExport() {
  if (!instance.value) return
  const destination = await invoke('dialog:saveFile', `${exportForm.name || instance.value.name}.mrpack`, [
    { name: 'Modrinth modpack', extensions: ['mrpack'] },
  ])
  if (!destination) return
  exporting.value = true
  try {
    const path = await invoke('modpack:export', instance.value.id, {
      name: exportForm.name || instance.value.name,
      version: exportForm.version || '1.0.0',
      summary: exportForm.summary || undefined,
      include: include.value,
      destination,
    })
    store.notify(t('instances.export.done', { path }), 'success')
  } catch (e) {
    store.fail(e)
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  void versions.load()
  void invoke('java:list').then((list) => (store.javas = list)).catch(() => undefined)
})
</script>

<template>
  <div class="page" data-testid="page-instance-detail">
    <div v-if="!instance" class="card empty">
      {{ t('instances.empty') }}
      <div style="margin-top: 12px"><RouterLink to="/instances" class="btn">{{ t('common.back') }}</RouterLink></div>
    </div>
    <template v-else>
      <div class="page-header">
        <div class="row grow">
          <RouterLink to="/instances" class="btn btn-ghost btn-icon" :aria-label="t('common.back')">
            <Icon name="chevronLeft" />
          </RouterLink>
          <div class="grow">
            <h1 class="truncate" data-testid="detail-title">{{ instance.name }}</h1>
            <div class="small faint">
              {{ instance.minecraft }} ·
              {{ instance.loader === 'vanilla' ? t('loader.vanilla') : `${t(`loader.${instance.loader}`)} ${instance.loaderVersion ?? ''}` }}
              · {{ instance.versionId ? t('instances.installed') : t('instances.notInstalled') }}
            </div>
          </div>
        </div>
        <div class="row">
          <button class="btn" data-testid="install-instance" @click="installNow"><Icon name="download" :size="16" />{{ t('instances.installNow') }}</button>
          <button class="btn" @click="invoke('instance:openFolder', instance.id).catch(store.fail)">
            <Icon name="folder" :size="16" />{{ t('common.openFolder') }}
          </button>
          <button class="btn btn-danger" data-testid="delete-instance" @click="remove"><Icon name="trash" :size="16" />{{ t('common.delete') }}</button>
          <button class="btn btn-primary" @click="playThis"><Icon name="play" :size="16" />{{ t('home.play') }}</button>
        </div>
      </div>

      <div class="tabs">
        <button v-for="item in TABS" :key="item" :class="{ active: tab === item }" :data-testid="`tab-${item}`" @click="tab = item">
          {{ t(`instances.tabs.${item}`) }}
        </button>
      </div>

      <section v-if="tab === 'settings'" class="card" data-testid="instance-settings">
        <div class="form-grid">
          <div class="field full">
            <label for="d-name">{{ t('instances.name') }}</label>
            <input id="d-name" v-model="form.name" class="input" />
          </div>
          <div class="field">
            <label for="d-mc">{{ t('instances.minecraft') }}</label>
            <select id="d-mc" v-model="form.minecraft" class="select">
              <option v-for="v in mcOptions" :key="v.id" :value="v.id">{{ v.id }}</option>
            </select>
          </div>
          <div class="field">
            <label for="d-loader-version">{{ t('instances.loaderVersion') }}</label>
            <select v-if="form.loader !== 'vanilla' && loaderVersions.length" id="d-loader-version" v-model="form.loaderVersion" class="select">
              <option v-for="v in loaderVersions" :key="v" :value="v">{{ v }}</option>
            </select>
            <input v-else id="d-loader-version" class="input" disabled :value="form.loader === 'vanilla' ? t('common.none') : (loaderError ?? t('common.loading'))" />
          </div>
          <div class="field full">
            <span class="field-label">{{ t('instances.loader') }}</span>
            <div class="segmented">
              <button v-for="type in LOADER_TYPES" :key="type" type="button" :class="{ active: form.loader === type }" @click="form.loader = type">
                {{ t(`loader.${type}`) }}
              </button>
            </div>
            <p v-if="versionChanged" class="hint">{{ t('instances.settings.versionChangeWarning') }}</p>
          </div>
          <div class="field full">
            <label for="d-java">{{ t('instances.settings.java') }}</label>
            <select id="d-java" v-model="form.javaPath" class="select">
              <option value="">{{ t('instances.settings.javaAuto') }}</option>
              <option v-for="j in store.javas" :key="j.path" :value="j.path">Java {{ j.version }} — {{ j.path }}</option>
            </select>
          </div>
          <div class="field">
            <label for="d-min">{{ t('instances.settings.minMemory') }}</label>
            <input id="d-min" v-model.number="form.minMemory" class="input" type="number" min="0" step="256" :placeholder="t('common.auto')" />
          </div>
          <div class="field">
            <label for="d-max">{{ t('instances.settings.memory') }}</label>
            <input
              id="d-max"
              v-model.number="form.maxMemory"
              class="input"
              type="number"
              min="0"
              step="256"
              :placeholder="`${t('common.default')} ${store.config?.defaultMaxMemory ?? ''}`"
            />
          </div>
          <div class="field full">
            <label for="d-jvm">{{ t('instances.settings.jvmArgs') }}</label>
            <input id="d-jvm" v-model="form.jvmArgs" class="input mono" placeholder="-XX:+UseG1GC" />
          </div>
          <div class="field full">
            <label for="d-mcargs">{{ t('instances.settings.mcArgs') }}</label>
            <input id="d-mcargs" v-model="form.mcArgs" class="input mono" />
          </div>
          <div class="field">
            <span class="field-label">{{ t('instances.settings.resolution') }}</span>
            <div class="row">
              <input v-model.number="form.width" class="input" type="number" min="0" :placeholder="t('instances.settings.width')" :aria-label="t('instances.settings.width')" />
              <span class="faint">×</span>
              <input v-model.number="form.height" class="input" type="number" min="0" :placeholder="t('instances.settings.height')" :aria-label="t('instances.settings.height')" />
            </div>
          </div>
          <div class="field">
            <span class="field-label">&nbsp;</span>
            <label class="check"><input v-model="form.fullscreen" type="checkbox" />{{ t('instances.settings.fullscreen') }}</label>
          </div>
          <div class="field">
            <label for="d-host">{{ t('instances.settings.server') }}</label>
            <input id="d-host" v-model="form.serverHost" class="input" :placeholder="t('instances.settings.serverHost')" />
          </div>
          <div class="field">
            <label for="d-port">{{ t('instances.settings.serverPort') }}</label>
            <input id="d-port" v-model.number="form.serverPort" class="input" type="number" min="0" max="65535" placeholder="25565" />
          </div>
        </div>
        <div class="row actions">
          <button class="btn" @click="reset(instance)">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" data-testid="save-instance" @click="save">{{ t('common.save') }}</button>
        </div>
      </section>

      <section v-else-if="tab === 'mods'" class="card"><LocalResourceList :instance-id="instance.id" kind="mod" /></section>
      <section v-else-if="tab === 'resourcepacks'" class="card"><LocalResourceList :instance-id="instance.id" kind="resourcepack" /></section>
      <section v-else-if="tab === 'shaders'" class="card"><LocalResourceList :instance-id="instance.id" kind="shader" /></section>

      <section v-else class="card" data-testid="instance-export">
        <div class="card-title"><h2>{{ t('instances.export.title') }}</h2></div>
        <div class="form-grid">
          <div class="field">
            <label for="e-name">{{ t('instances.export.name') }}</label>
            <input id="e-name" v-model="exportForm.name" class="input" />
          </div>
          <div class="field">
            <label for="e-version">{{ t('instances.export.version') }}</label>
            <input id="e-version" v-model="exportForm.version" class="input" />
          </div>
          <div class="field full">
            <label for="e-summary">{{ t('instances.export.summary') }}</label>
            <input id="e-summary" v-model="exportForm.summary" class="input" :placeholder="t('common.optional')" />
          </div>
          <div class="field full">
            <span class="field-label">{{ t('instances.export.include') }}</span>
            <div class="row wrap">
              <label v-for="entry in EXPORT_ENTRIES" :key="entry" class="check mono">
                <input v-model="include" type="checkbox" :value="entry" />{{ entry }}
              </label>
            </div>
          </div>
        </div>
        <p class="hint small muted" style="margin-top: 12px">{{ t('instances.export.hint') }}</p>
        <div class="row actions">
          <button class="btn btn-primary" :disabled="exporting" data-testid="export-run" @click="runExport">
            <Icon name="upload" :size="16" />{{ t('instances.export.run') }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.tabs {
  margin-bottom: 14px;
}

.actions {
  justify-content: flex-end;
  margin-top: 18px;
}

.page-header {
  flex-wrap: wrap;
}
</style>
