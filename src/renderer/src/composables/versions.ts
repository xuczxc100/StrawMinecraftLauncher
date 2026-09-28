import { ref } from 'vue'
import type { MinecraftVersionListResult } from '@shared/types'
import { invoke } from '../api'

const list = ref<MinecraftVersionListResult>()
const loading = ref(false)
const error = ref<string>()
let pending: Promise<void> | undefined

/** Shared, lazily loaded Minecraft version manifest. */
export function useMinecraftVersions() {
  function load(force = false) {
    if (list.value && !force) return Promise.resolve()
    if (pending && !force) return pending
    loading.value = true
    error.value = undefined
    pending = invoke('version:listMinecraft', force)
      .then((result) => {
        list.value = result
      })
      .catch((e) => {
        error.value = e instanceof Error ? e.message : String(e)
      })
      .finally(() => {
        loading.value = false
        pending = undefined
      })
    return pending
  }
  return { list, loading, error, load }
}
