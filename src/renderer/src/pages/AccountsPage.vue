<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Account, DeviceCodeInfo } from '@shared/types'
import { errorCode, invoke } from '../api'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import { formatDate } from '../format'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const { t } = useI18n()

const offlineName = ref('')
const addingOffline = ref(false)
const device = ref<DeviceCodeInfo>()
const copied = ref(false)
const refreshing = ref<string>()

const validName = computed(() => /^[A-Za-z0-9_]{3,16}$/.test(offlineName.value))

async function addOffline() {
  if (!validName.value) return
  addingOffline.value = true
  try {
    const account = await invoke('account:addOffline', offlineName.value)
    offlineName.value = ''
    store.notify(t('accounts.loginDone', { name: account.name }), 'success')
  } catch (e) {
    store.fail(e)
  } finally {
    addingOffline.value = false
  }
}

async function microsoft() {
  try {
    const info = await invoke('account:microsoftBegin')
    device.value = info
    copied.value = false
    const account = await invoke('account:microsoftComplete', info.sessionId)
    store.notify(t('accounts.loginDone', { name: account.name }), 'success')
  } catch (e) {
    if (errorCode(e) !== 'Cancelled') store.fail(e)
  } finally {
    device.value = undefined
  }
}

function cancelDevice() {
  if (device.value) void invoke('account:microsoftCancel', device.value.sessionId)
  device.value = undefined
}

async function copyCode() {
  if (!device.value) return
  try {
    await navigator.clipboard.writeText(device.value.userCode)
    copied.value = true
  } catch (e) {
    store.fail(e)
  }
}

async function refresh(account: Account) {
  refreshing.value = account.id
  try {
    await invoke('account:refresh', account.id)
    store.notify(t('accounts.loginDone', { name: account.name }), 'success')
  } catch (e) {
    store.fail(e)
  } finally {
    refreshing.value = undefined
  }
}

async function remove(account: Account) {
  if (!confirm(t('accounts.removeConfirm', { name: account.name }))) return
  await invoke('account:remove', account.id).catch(store.fail)
}

onBeforeUnmount(cancelDevice)
</script>

<template>
  <div class="page" data-testid="page-accounts">
    <div class="page-header"><h1>{{ t('accounts.title') }}</h1></div>

    <div class="add-grid">
      <section class="card">
        <div class="card-title"><h2>{{ t('accounts.microsoft') }}</h2></div>
        <div v-if="!store.info?.msLoginAvailable" class="notice warn" data-testid="ms-not-configured">
          <Icon name="key" :size="16" />
          <span class="grow">{{ t('accounts.msNotConfigured') }}</span>
          <RouterLink to="/settings" class="btn btn-sm">{{ t('nav.settings') }}</RouterLink>
        </div>
        <button
          class="btn btn-primary ms"
          :disabled="!store.info?.msLoginAvailable || !!device"
          data-testid="add-microsoft"
          @click="microsoft"
        >
          <Icon name="user" :size="16" />{{ t('accounts.addMicrosoft') }}
        </button>
      </section>

      <section class="card">
        <div class="card-title"><h2>{{ t('accounts.offline') }}</h2></div>
        <form class="stack" @submit.prevent="addOffline">
          <div class="field">
            <label for="offline-name">{{ t('accounts.offlineName') }}</label>
            <div class="row">
              <input
                id="offline-name"
                v-model="offlineName"
                class="input grow"
                maxlength="16"
                autocomplete="off"
                spellcheck="false"
                data-testid="offline-name"
              />
              <button class="btn btn-primary" type="submit" :disabled="!validName || addingOffline" data-testid="add-offline">
                <Icon name="plus" :size="16" />{{ t('accounts.addOffline') }}
              </button>
            </div>
            <p class="hint" :class="{ 'text-danger': offlineName && !validName }">{{ t('accounts.offlineHint') }}</p>
          </div>
        </form>
      </section>
    </div>

    <section class="card">
      <div class="card-title"><h2>{{ t('accounts.title') }}</h2></div>
      <div v-if="!store.accounts.length" class="empty">{{ t('accounts.empty') }}</div>
      <div v-else class="list" data-testid="account-list">
        <div v-for="account in store.accounts" :key="account.id" class="list-item">
          <div class="avatar">{{ account.name.slice(0, 1).toUpperCase() }}</div>
          <div class="grow">
            <div class="row">
              <strong class="truncate">{{ account.name }}</strong>
              <span class="badge" :class="{ accent: account.type === 'microsoft' }">{{ t(`accounts.${account.type}`) }}</span>
              <span v-if="account.id === store.selectedAccountId" class="badge success">{{ t('accounts.current') }}</span>
            </div>
            <div class="small faint mono truncate">
              {{ account.uuid }}
              <template v-if="account.expiresAt"> · {{ t('accounts.expires', { date: formatDate(account.expiresAt) }) }}</template>
            </div>
          </div>
          <button v-if="account.id !== store.selectedAccountId" class="btn btn-sm" @click="store.selectAccount(account.id)">
            {{ t('accounts.use') }}
          </button>
          <button
            v-if="account.type === 'microsoft'"
            class="btn btn-sm"
            :disabled="refreshing === account.id"
            @click="refresh(account)"
          >
            {{ t('accounts.refresh') }}
          </button>
          <button class="btn btn-ghost btn-icon" :aria-label="t('common.delete')" @click="remove(account)">
            <Icon name="trash" :size="16" />
          </button>
        </div>
      </div>
    </section>

    <Modal v-if="device" :title="t('accounts.deviceTitle')" @close="cancelDevice">
      <div class="stack device">
        <p>{{ t('accounts.deviceStep') }}</p>
        <a href="#" @click.prevent="invoke('shell:openExternal', device.verificationUri)">{{ device.verificationUri }}</a>
        <div class="code mono" data-testid="device-code">{{ device.userCode }}</div>
        <button class="btn" @click="copyCode"><Icon :name="copied ? 'check' : 'list'" :size="16" />{{ copied ? t('accounts.copied') : t('accounts.copyCode') }}</button>
        <div class="progress indeterminate"><div /></div>
        <p class="small muted">{{ t('accounts.waiting') }}</p>
      </div>
      <template #footer>
        <button class="btn" @click="cancelDevice">{{ t('common.cancel') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.add-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.add-grid .card + .card {
  margin-top: 0;
}

.ms {
  margin-top: 12px;
}

.device {
  align-items: center;
  text-align: center;
}

.device .progress {
  width: 100%;
}

.code {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.18em;
  padding: 10px 18px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  user-select: all;
}
</style>
