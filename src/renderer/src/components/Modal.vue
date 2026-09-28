<script setup lang="ts">
import Icon from './Icon.vue'

withDefaults(defineProps<{ title: string; width?: number }>(), { width: 520 })
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown.self="emit('close')">
      <div class="modal" role="dialog" :aria-label="title" :style="{ width: `${width}px` }">
        <header>
          <h2>{{ title }}</h2>
          <button class="btn btn-ghost btn-icon" :aria-label="$t('common.close')" @click="emit('close')">
            <Icon name="close" />
          </button>
        </header>
        <div class="body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  z-index: 50;
}

.modal {
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px 20px;
}

.body {
  padding: 6px 20px 18px;
  overflow-y: auto;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
}
</style>
