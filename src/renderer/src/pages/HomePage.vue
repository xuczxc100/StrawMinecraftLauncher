<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { invoke } from '../api'
import CreateInstanceDialog from '../components/CreateInstanceDialog.vue'
import Icon from '../components/Icon.vue'
import LogView from '../components/LogView.vue'
import { formatDate } from '../format'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const router = useRouter()
const { t } = useI18n()
const creating = ref(false)
const showLogs = ref(false)

const instance = computed(() => store.selectedInstance)
const state = computed(() => (instance.value ? store.launchStates[instance.value.id] : undefined))
const busy = computed(() => ['preparing', 'launching', 'running'].includes(state.value?.status ?? ''))
const lines = computed(() => (instance.value ? (store.logs[instance.value.id] ?? []) : []))

const recent = computed(() =>
  [...store.instances].sort((a, b) => (b.lastPlayed ?? b.createdAt) - (a.lastPlayed ?? a.createdAt)).slice(0, 6),
)

const launchLabel = computed(() => {
  switch (state.value?.status) {
    case 'preparing':
      return t('home.preparing')
    case 'launching':
      return t('home.launching')
    case 'running':
      return t('home.running')
    default:
      return t('home.play')
  }
})

async function launch() {
  if (!instance.value) return
  if (!store.selectedAccount) {
    store.notify(t('errors.NoAccount'), 'error')
    router.push('/accounts')
    return
  }
  showLogs.value = true
  await store.launch(instance.value.id)
}

async function kill() {
  if (instance.value) await invoke('launch:kill', instance.value.id).catch(store.fail)
}

function loaderText(loader: string, version?: string) {
  return loader === 'vanilla' ? t('loader.vanilla') : `${t(`loader.${loader}`)} ${version ?? ''}`.trim()
}
</script>

<template>
  <div class="page" data-testid="page-home">
    <div class="page-header">
      <h1>{{ t('home.welcome') }}<template v-if="store.selectedAccount">，{{ store.selectedAccount.name }}</template></h1>
    </div>

    <div v-if="!instance" class="card empty-state">
      <Icon name="cube" :size="40" />
      <h2>{{ t('home.noInstance') }}</h2>
      <p class="muted">{{ t('home.noInstanceHint') }}</p>
      <button class="btn btn-primary" data-testid="home-create-instance" @click="creating = true">
        <Icon name="plus" />{{ t('home.createFirst') }}
      </button>
    </div>

    <template v-else>
      <section class="card hero">
        <div class="hero-main">
          <div class="icon-tile large"><Icon name="cube" :size="30" /></div>
          <div class="grow">
            <div class="row wrap">
              <h2 class="truncate" data-testid="home-instance-name">{{ instance.name }}</h2>
              <span class="badge">{{ instance.minecraft }}</span>
              <span class="badge accent">{{ loaderText(instance.loader, instance.loaderVersion) }}</span>
            </div>
            <p class="small faint">
              {{ t('home.lastPlayed') }}：{{ instance.lastPlayed ? formatDate(instance.lastPlayed) : t('home.neverPlayed') }}
            </p>
          </div>
        </div>
        <div class="hero-controls">
          <div class="field">
            <label for="home-instance">{{ t('home.selectInstance') }}</label>
            <select
              id="home-instance"
              class="select"
              :value="instance.id"
              data-testid="home-instance-select"
              @change="store.selectInstance(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="item in store.instances" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </div>
          <div class="field">
            <label for="home-account">{{ t('home.selectAccount') }}</label>
            <select
              v-if="store.accounts.length"
              id="home-account"
              class="select"
              :value="store.selectedAccountId"
              @change="store.selectAccount(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="acc in store.accounts" :key="acc.id" :value="acc.id">
                {{ acc.name }}（{{ t(`accounts.${acc.type}`) }}）
              </option>
            </select>
            <RouterLink v-else to="/accounts" class="btn">{{ t('home.addAccount') }}</RouterLink>
          </div>
          <div class="launch-row">
            <button class="btn btn-primary btn-lg grow" :disabled="busy" data-testid="launch-button" @click="launch">
              <Icon name="play" />{{ launchLabel }}
            </button>
            <button v-if="busy" class="btn btn-danger btn-lg" data-testid="kill-button" @click="kill">
              <Icon name="stop" />{{ t('home.stop') }}
            </button>
          </div>
        </div>
      </section>

      <div v-if="store.selectedAccount?.type === 'offline'" class="notice">
        <Icon name="info" :size="16" />{{ t('home.supportOfficial') }}
      </div>

      <div v-if="state?.status === 'failed'" class="notice warn" data-testid="launch-failed">
        <Icon name="alert" :size="16" />{{ t('home.failed', { error: state.error ?? '' }) }}
      </div>
      <div v-else-if="state?.status === 'crashed'" class="notice warn">
        <Icon name="alert" :size="16" />{{ t('home.crashed', { code: state.exitCode ?? '?' }) }}
      </div>
      <div v-else-if="state?.status === 'exited'" class="notice">
        <Icon name="info" :size="16" />{{ t('home.exited', { code: state.exitCode ?? 0 }) }}
      </div>

      <section v-if="state?.crashReport" class="card">
        <div class="card-title"><h2>{{ t('home.crashReport') }}</h2></div>
        <pre class="log-view crash">{{ state.crashReport }}</pre>
      </section>

      <section class="card">
        <div class="card-title">
          <h2>{{ t('home.logs') }}</h2>
          <button class="btn btn-sm btn-ghost" data-testid="toggle-logs" @click="showLogs = !showLogs">
            {{ showLogs ? t('home.hideLogs') : t('home.showLogs') }}
          </button>
        </div>
        <LogView v-if="showLogs" :lines="lines" />
      </section>

      <section class="card">
        <div class="card-title">
          <h2>{{ t('home.recent') }}</h2>
          <button class="btn btn-sm" @click="creating = true"><Icon name="plus" :size="16" />{{ t('instances.create') }}</button>
        </div>
        <div class="grid">
          <button
            v-for="item in recent"
            :key="item.id"
            class="recent-item"
            :class="{ active: item.id === instance.id }"
            @click="store.selectInstance(item.id)"
          >
            <div class="icon-tile"><Icon name="cube" /></div>
            <div class="grow">
              <div class="truncate">{{ item.name }}</div>
              <div class="small faint truncate">{{ item.minecraft }} · {{ loaderText(item.loader, item.loaderVersion) }}</div>
            </div>
          </button>
        </div>
      </section>
    </template>

    <CreateInstanceDialog v-if="creating" @close="creating = false" @created="creating = false" />
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 24px;
  text-align: center;
  color: var(--muted);
}

.empty-state h2 {
  color: var(--text);
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 24px;
  align-items: center;
}

.hero-main {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.icon-tile.large {
  width: 64px;
  height: 64px;
  border-radius: 14px;
}

.hero-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.launch-row {
  display: flex;
  gap: 10px;
}

.notice {
  margin-top: 14px;
}

.notice + .card,
.hero + .card {
  margin-top: 14px;
}

.crash {
  max-height: 260px;
  white-space: pre-wrap;
  margin: 0;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.recent-item.active {
  border-color: var(--accent);
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
  }
}
</style>
