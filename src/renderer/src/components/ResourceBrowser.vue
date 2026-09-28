<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LocalResourceKind } from '@shared/ipc'
import type { ResourceHit, ResourceKind, ResourceSort, ResourceSource, ResourceVersion } from '@shared/types'
import { errorCode, invoke } from '../api'
import { formatCount } from '../format'
import { useAppStore } from '../stores/app'
import Icon from './Icon.vue'
import VersionPickerDialog from './VersionPickerDialog.vue'

const props = defineProps<{ fixedKind?: ResourceKind; initialKind?: ResourceKind; initialInstance?: string }>()
const store = useAppStore()
const { t } = useI18n()

const PAGE_SIZE = 20
const KINDS: ResourceKind[] = ['mod', 'resourcepack', 'shader', 'modpack']
const SORTS: ResourceSort[] = ['relevance', 'downloads', 'updated', 'newest']

const source = ref<ResourceSource>('modrinth')
const kind = ref<ResourceKind>(props.fixedKind ?? props.initialKind ?? 'mod')
const targetId = ref(props.initialInstance ?? store.selectedInstance?.id ?? '')
const filterByInstance = ref(true)
const query = ref('')
const sort = ref<ResourceSort>('relevance')
const page = ref(0)
const hits = ref<ResourceHit[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<string>()
const busy = ref<Record<string, boolean>>({})
const picking = ref<ResourceHit>()

const isModpack = computed(() => kind.value === 'modpack')
const target = computed(() => store.instances.find((i) => i.id === targetId.value))
const filtering = computed(() => !isModpack.value && filterByInstance.value && !!target.value)
const gameVersion = computed(() => (filtering.value ? target.value?.minecraft : undefined))
const loader = computed(() =>
  filtering.value && kind.value === 'mod' && target.value?.loader !== 'vanilla' ? target.value?.loader : undefined,
)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const curseforgeMissing = computed(() => source.value === 'curseforge' && !store.info?.curseforgeAvailable)

let request = 0
async function search() {
  if (curseforgeMissing.value) {
    hits.value = []
    total.value = 0
    return
  }
  const req = ++request
  loading.value = true
  error.value = undefined
  try {
    const result = await invoke('resource:search', {
      source: source.value,
      kind: kind.value,
      query: query.value.trim(),
      gameVersion: gameVersion.value,
      loader: loader.value,
      sort: sort.value,
      offset: page.value * PAGE_SIZE,
      limit: PAGE_SIZE,
    })
    if (req !== request) return
    hits.value = result.hits
    total.value = result.total
  } catch (e) {
    if (req === request) error.value = store.describeError(e)
  } finally {
    if (req === request) loading.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    page.value = 0
    void search()
  }, 350)
})
watch([source, kind, targetId, filterByInstance, sort], () => {
  page.value = 0
  void search()
})
watch(page, () => void search())

async function install(hit: ResourceHit, version?: ResourceVersion) {
  picking.value = undefined
  const key = `${hit.source}:${hit.projectId}`
  busy.value = { ...busy.value, [key]: true }
  try {
    if (isModpack.value) {
      const result = await invoke('modpack:importRemote', hit.source, hit.projectId, version?.versionId)
      store.notify(t('modpacks.imported', { name: result.instance.name }), 'success')
      if (result.skippedFiles.length) store.notify(t('modpacks.skipped', { count: result.skippedFiles.length }), 'info')
    } else {
      if (!target.value) {
        store.notify(t('resources.noTarget'), 'error')
        return
      }
      const result = await invoke(
        'resource:install',
        target.value.id,
        kind.value as LocalResourceKind,
        hit.source,
        hit.projectId,
        version?.versionId,
      )
      if (result.installed.length) store.notify(t('resources.installDone', { count: result.installed.length }), 'success')
      if (result.skipped.length) {
        const reasons = result.skipped.map((s) => s.reason).join('；')
        store.notify(t('resources.installSkipped', { count: result.skipped.length, reasons }), 'error')
      }
    }
  } catch (e) {
    if (errorCode(e) === 'NoCompatibleVersion') {
      store.notify(
        t('resources.noVersions', { mc: gameVersion.value ?? '', loader: loader.value ? t(`loader.${loader.value}`) : '' }),
        'error',
      )
    } else store.fail(e)
  } finally {
    busy.value = { ...busy.value, [key]: false }
  }
}

onMounted(search)
</script>

<template>
  <div class="stack" data-testid="resource-browser">
    <div class="card filters">
      <div class="row wrap">
        <div class="segmented" role="radiogroup" :aria-label="t('resources.source')">
          <button :class="{ active: source === 'modrinth' }" data-testid="source-modrinth" @click="source = 'modrinth'">Modrinth</button>
          <button :class="{ active: source === 'curseforge' }" data-testid="source-curseforge" @click="source = 'curseforge'">CurseForge</button>
        </div>
        <div v-if="!fixedKind" class="segmented" role="radiogroup" :aria-label="t('resources.kind')">
          <button v-for="k in KINDS" :key="k" :class="{ active: kind === k }" :data-testid="`kind-${k}`" @click="kind = k">
            {{ t(`resources.kinds.${k}`) }}
          </button>
        </div>
      </div>
      <div class="row wrap">
        <div class="search grow">
          <Icon name="search" :size="16" />
          <input v-model="query" class="input" :placeholder="t('resources.query')" data-testid="resource-query" @keydown.enter="search" />
        </div>
        <select v-model="sort" class="select sort" :aria-label="t('resources.sort')">
          <option v-for="s in SORTS" :key="s" :value="s">{{ t(`resources.sorts.${s}`) }}</option>
        </select>
      </div>
      <div v-if="!isModpack" class="row wrap">
        <label class="small muted" for="rb-target">{{ t('resources.target') }}</label>
        <select v-if="store.instances.length" id="rb-target" v-model="targetId" class="select target" data-testid="resource-target">
          <option v-for="i in store.instances" :key="i.id" :value="i.id">{{ i.name }}（{{ i.minecraft }} {{ t(`loader.${i.loader}`) }}）</option>
        </select>
        <span v-else class="small text-danger">{{ t('resources.noTarget') }}</span>
        <label class="check small"><input v-model="filterByInstance" type="checkbox" />{{ t('resources.filterByInstance') }}</label>
      </div>
    </div>

    <div v-if="curseforgeMissing" class="notice warn" data-testid="curseforge-missing">
      <Icon name="key" :size="16" />
      <span class="grow">{{ t('resources.curseforgeMissing') }}</span>
      <RouterLink to="/settings" class="btn btn-sm">{{ t('nav.settings') }}</RouterLink>
    </div>
    <div v-else-if="error" class="notice warn">
      <Icon name="alert" :size="16" /><span class="grow">{{ error }}</span>
      <button class="btn btn-sm" @click="search">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="loading && !hits.length" class="card empty">{{ t('common.loading') }}</div>
    <div v-else-if="!hits.length" class="card empty">{{ t('resources.empty') }}</div>
    <div v-else class="list" :class="{ dim: loading }" data-testid="resource-results">
      <div v-for="hit in hits" :key="hit.projectId" class="list-item hit">
        <div class="icon-tile">
          <img v-if="hit.iconUrl" :src="hit.iconUrl" alt="" loading="lazy" />
          <Icon v-else name="puzzle" />
        </div>
        <div class="grow">
          <div class="row">
            <strong class="truncate">{{ hit.title }}</strong>
            <span class="small faint truncate">{{ t('resources.by', { author: hit.author }) }}</span>
          </div>
          <p class="small muted desc">{{ hit.description }}</p>
          <div class="small faint">{{ t('resources.downloads', { count: formatCount(hit.downloads) }) }}</div>
        </div>
        <div class="hit-actions">
          <button
            class="btn btn-sm btn-primary"
            :disabled="busy[`${hit.source}:${hit.projectId}`] || (!isModpack && !target)"
            :data-testid="`install-${hit.slug}`"
            @click="install(hit)"
          >
            <Icon name="download" :size="15" />{{ isModpack ? t('modpacks.installAsInstance') : t('resources.latestCompatible') }}
          </button>
          <div class="row">
            <button class="btn btn-sm" :disabled="!isModpack && !target" @click="picking = hit">{{ t('resources.chooseVersion') }}</button>
            <button class="btn btn-sm btn-ghost btn-icon" :aria-label="t('resources.openPage')" @click="invoke('shell:openExternal', hit.pageUrl)">
              <Icon name="external" :size="15" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="total > PAGE_SIZE" class="row pager">
      <button class="btn btn-sm" :disabled="page === 0 || loading" @click="page--">{{ t('resources.prev') }}</button>
      <span class="small muted">{{ t('resources.page', { page: page + 1 }) }} / {{ pages }}</span>
      <button class="btn btn-sm" :disabled="page + 1 >= pages || loading" data-testid="next-page" @click="page++">{{ t('resources.next') }}</button>
    </div>

    <VersionPickerDialog
      v-if="picking"
      :title="picking.title"
      :source="picking.source"
      :project-id="picking.projectId"
      :kind="kind"
      :game-version="gameVersion"
      :loader="loader"
      @close="picking = undefined"
      @pick="(v) => picking && install(picking, v)"
    />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 220px;
}

.search svg {
  position: absolute;
  left: 10px;
  color: var(--faint);
}

.search .input {
  padding-left: 34px;
  width: 100%;
}

.sort {
  width: 150px;
}

.target {
  width: auto;
  min-width: 220px;
  max-width: 100%;
}

.hit {
  align-items: flex-start;
}

.desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hit-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.dim {
  opacity: 0.6;
}

.pager {
  justify-content: center;
}
</style>
