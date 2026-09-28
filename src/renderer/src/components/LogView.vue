<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { LaunchLogLine } from '@shared/types'

const props = defineProps<{ lines: LaunchLogLine[] }>()
const el = ref<HTMLElement>()
let stick = true

function onScroll() {
  const node = el.value
  if (node) stick = node.scrollHeight - node.scrollTop - node.clientHeight < 24
}

watch(
  () => props.lines.length,
  async () => {
    if (!stick) return
    await nextTick()
    if (el.value) el.value.scrollTop = el.value.scrollHeight
  },
  { immediate: true },
)
</script>

<template>
  <div ref="el" class="log-view" data-testid="log-view" @scroll="onScroll">
    <div v-for="(line, i) in lines" :key="i" :class="line.stream">{{ line.line }}</div>
  </div>
</template>
