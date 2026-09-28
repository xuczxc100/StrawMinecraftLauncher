<script setup lang="ts">
import { reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig } from '@shared/types'
import { invoke } from '../api'
import Icon from '../components/Icon.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useI18n()
const ACCENTS = ['#e0a526', '#4f9d69', '#3d8bd9', '#c0504d', '#8e6fd6', '#d9772b']
const REPO_URL = 'https://github.com/xuczxc100/StrawMinecraftLauncher'
const XMCL_URL = 'https://github.com/Voxelum/x-minecraft-launcher'

const keys = reactive({ msClientId: '', curseforgeApiKey: '' })
watch(
  () => store.config,
  (cfg) => {
    if (!cfg) return
    keys.msClientId = cfg.msClientId
    keys.curseforgeApiKey = cfg.curseforgeApiKey
  },
  { immediate: true },
)

async function update(patch: Partial<AppConfig>) {
  try {
    await store.updateConfig(patch)
  } catch (e) {
    store.fail(e)
  }
}

async function saveKeys() {
  await update({ msClientId: keys.msClientId.trim(), curseforgeApiKey: keys.curseforgeApiKey.trim() })
  store.notify(t('common.saved'), 'success')
}

function numberValue(event: Event) {
  return Number((event.target as HTMLInputElement).value)
}
</script>

<template>
  <div v-if="store.config" class="page" data-testid="page-settings">
    <div class="page-header"><h1>{{ t('settings.title') }}</h1></div>

    <section class="card">
      <div class="card-title"><h2>{{ t('settings.general') }}</h2></div>
      <div class="form-grid">
        <div class="field">
          <label for="s-locale">{{ t('settings.language') }}</label>
          <select
            id="s-locale"
            class="select"
            :value="store.config.locale"
            data-testid="settings-locale"
            @change="update({ locale: ($event.target as HTMLSelectElement).value as AppConfig['locale'] })"
          >
            <option value="zh-TW">繁體中文</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="field">
          <span class="field-label">{{ t('settings.theme') }}</span>
          <div class="segmented">
            <button
              v-for="mode in ['dark', 'light'] as const"
              :key="mode"
              :class="{ active: store.config.theme === mode }"
              :data-testid="`theme-${mode}`"
              @click="update({ theme: mode })"
            >
              {{ t(`settings.themes.${mode}`) }}
            </button>
          </div>
        </div>
        <div class="field full">
          <span class="field-label">{{ t('settings.accent') }}</span>
          <div class="row wrap">
            <button
              v-for="color in ACCENTS"
              :key="color"
              class="swatch"
              :class="{ active: store.config.accentColor === color }"
              :style="{ background: color }"
              :aria-label="color"
              @click="update({ accentColor: color })"
            />
            <input
              class="color"
              type="color"
              :value="store.config.accentColor"
              :aria-label="t('settings.accent')"
              @change="update({ accentColor: ($event.target as HTMLInputElement).value })"
            />
          </div>
        </div>
        <div class="field full">
          <label class="check">
            <input
              type="checkbox"
              :checked="store.config.closeOnLaunch"
              @change="update({ closeOnLaunch: ($event.target as HTMLInputElement).checked })"
            />{{ t('settings.closeOnLaunch') }}
          </label>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-title"><h2>{{ t('settings.download') }}</h2></div>
      <div class="form-grid">
        <div class="field">
          <label for="s-mirror">{{ t('settings.mirror') }}</label>
          <select
            id="s-mirror"
            class="select"
            :value="store.config.mirror"
            @change="update({ mirror: ($event.target as HTMLSelectElement).value as AppConfig['mirror'] })"
          >
            <option value="official">{{ t('settings.mirrors.official') }}</option>
            <option value="bmclapi">{{ t('settings.mirrors.bmclapi') }}</option>
          </select>
        </div>
        <div class="field">
          <label for="s-conc">{{ t('settings.concurrency') }}</label>
          <input
            id="s-conc"
            class="input"
            type="number"
            min="1"
            max="64"
            :value="store.config.downloadConcurrency"
            @change="update({ downloadConcurrency: numberValue($event) })"
          />
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-title"><h2>{{ t('settings.game') }}</h2></div>
      <div class="form-grid">
        <div class="field">
          <label for="s-mem">{{ t('settings.defaultMemory') }}</label>
          <input
            id="s-mem"
            class="input"
            type="number"
            min="512"
            step="256"
            :value="store.config.defaultMaxMemory"
            @change="update({ defaultMaxMemory: numberValue($event) })"
          />
          <p class="hint">{{ t('settings.totalMemory', { total: store.info?.totalMemoryMB ?? '?' }) }}</p>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-title"><h2>{{ t('settings.keys') }}</h2></div>
      <form class="stack" @submit.prevent="saveKeys">
        <div class="field">
          <label for="s-ms">
            {{ t('settings.msClientId') }}
            <span class="badge" :class="{ success: store.info?.msLoginAvailable }">
              {{ store.info?.msLoginAvailable ? t('common.enabled') : t('common.disabled') }}
            </span>
          </label>
          <input id="s-ms" v-model="keys.msClientId" class="input mono" autocomplete="off" spellcheck="false" data-testid="settings-ms-client-id" />
          <p class="hint">{{ t('settings.msClientIdHint') }}</p>
        </div>
        <div class="field">
          <label for="s-cf">
            {{ t('settings.curseforgeKey') }}
            <span class="badge" :class="{ success: store.info?.curseforgeAvailable }">
              {{ store.info?.curseforgeAvailable ? t('common.enabled') : t('common.disabled') }}
            </span>
          </label>
          <input
            id="s-cf"
            v-model="keys.curseforgeApiKey"
            class="input mono"
            type="password"
            autocomplete="off"
            spellcheck="false"
            data-testid="settings-curseforge-key"
          />
          <p class="hint">{{ t('settings.curseforgeKeyHint') }}</p>
        </div>
        <div class="row" style="justify-content: flex-end">
          <button class="btn btn-primary" type="submit" data-testid="settings-save-keys">{{ t('common.save') }}</button>
        </div>
      </form>
    </section>

    <section class="card" data-testid="settings-about">
      <div class="card-title"><h2>{{ t('settings.about') }}</h2></div>
      <div class="about">
        <img src="../assets/logo.svg" alt="" width="56" height="56" />
        <div class="stack grow">
          <div>
            <strong>StrawMinecraftLauncher (SMCL)</strong>
            <div class="small muted">{{ t('settings.version', { version: store.info?.version ?? '' }) }} · {{ store.info?.platform }}-{{ store.info?.arch }}</div>
            <div class="small faint mono truncate">{{ t('settings.dataDir', { path: store.info?.dataRoot ?? '' }) }}</div>
          </div>
          <p class="small">{{ t('settings.credits') }}</p>
          <p class="small muted" data-testid="settings-disclaimer">{{ t('settings.disclaimer') }}</p>
          <p class="small muted">{{ t('settings.license') }}</p>
          <div class="row wrap">
            <button class="btn btn-sm" @click="invoke('shell:openExternal', REPO_URL)"><Icon name="external" :size="15" />GitHub</button>
            <button class="btn btn-sm" @click="invoke('shell:openExternal', XMCL_URL)"><Icon name="external" :size="15" />XMCL</button>
            <button class="btn btn-sm" @click="invoke('shell:openExternal', 'https://www.minecraft.net/')">
              <Icon name="external" :size="15" />minecraft.net
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.swatch {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
}

.swatch.active {
  border-color: var(--text);
}

.color {
  width: 40px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}

.field label .badge {
  margin-left: 6px;
}

.about {
  display: flex;
  gap: 18px;
  align-items: flex-start;
}
</style>
