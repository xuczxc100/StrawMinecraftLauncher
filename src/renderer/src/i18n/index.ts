import { createI18n } from 'vue-i18n'
import en from './en'
import zhTW from './zh-TW'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-TW',
  fallbackLocale: 'en',
  messages: { 'zh-TW': zhTW, en },
})
