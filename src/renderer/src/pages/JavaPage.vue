<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '../api'
import Icon from '../components/Icon.vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useI18n()
const scanning = ref(false)
const installing = ref<number>()
const MAJORS = [8, 17, 21, 25]

async function scan() {
  scanning.value = true
  try {
    store.javas = await invoke('java:scan')
  } catch (e) {
    store.fail(e)
  } finally {
    scanning.value = false
  }
}

async function install(major: number) {
  installing.value = major
  store.taskDrawerOpen = true
  try {
    await invoke('java:install', major)
    store.javas = await invoke('java:list')
  } catch (e) {
    store.fail(e)
  } finally {
    installing.value = undefined
  }
}

async function addCustom() {
  const exe = store.info?.platform === 'win32' ? ['exe'] : ['*']
  const path = await invoke('dialog:openFile', [{ name: 'Java', extensions: exe }])
  if (!path) return
  try {
    await invoke('java:addCustom', path)
    store.javas = await invoke('java:list')
  } catch (e) {
    store.fail(e)
  }
}

async function removeCustom(path: string) {
  try {
    await invoke('java:removeCustom', path)
    store.javas = await invoke('java:list')
  } catch (e) {
    store.fail(e)
  }
}

onMounted(async () => {
  store.javas = await invoke('java:list').catch(() => store.javas)
})
</script>

<template>
  <div class="page" data-testid="page-java">
    <div class="page-header">
      <h1>{{ t('java.title') }}</h1>
      <div class="row">
        <button class="btn" @click="addCustom"><Icon name="plus" :size="16" />{{ t('java.addCustom') }}</button>
        <button class="btn btn-primary" :disabled="scanning" data-testid="java-scan" @click="scan">
          <Icon name="refresh" :size="16" />{{ t('java.scan') }}
        </button>
      </div>
    </div>

    <div class="notice"><Icon name="info" :size="16" />{{ t('java.requirement') }}</div>

    <section class="card installs">
      <div class="card-title"><h2>{{ t('java.installHint') }}</h2></div>
      <div class="row wrap">
        <button
          v-for="major in MAJORS"
          :key="major"
          class="btn"
          :disabled="installing !== undefined"
          :data-testid="`java-install-${major}`"
          @click="install(major)"
        >
          <Icon name="download" :size="16" />{{ t('java.install', { major }) }}
        </button>
      </div>
    </section>

    <section class="card">
      <div v-if="!store.javas.length" class="empty">{{ t('java.empty') }}</div>
      <div v-else class="list" data-testid="java-list">
        <div v-for="j in store.javas" :key="j.path" class="list-item">
          <div class="icon-tile"><Icon name="coffee" /></div>
          <div class="grow">
            <div class="row">
              <strong>Java {{ j.majorVersion }}</strong>
              <span class="small muted">{{ j.version }}</span>
              <span class="badge" :class="{ accent: j.source === 'managed' }">{{ t(`java.source.${j.source}`) }}</span>
            </div>
            <div class="small faint mono truncate">{{ j.path }}</div>
          </div>
          <button v-if="j.source === 'custom'" class="btn btn-sm btn-ghost" @click="removeCustom(j.path)">{{ t('java.remove') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.installs {
  margin-top: 14px;
}
</style>
