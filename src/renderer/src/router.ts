import { createRouter, createWebHashHistory } from 'vue-router'
import AccountsPage from './pages/AccountsPage.vue'
import HomePage from './pages/HomePage.vue'
import InstanceDetailPage from './pages/InstanceDetailPage.vue'
import InstancesPage from './pages/InstancesPage.vue'
import JavaPage from './pages/JavaPage.vue'
import ModpacksPage from './pages/ModpacksPage.vue'
import ResourcesPage from './pages/ResourcesPage.vue'
import SettingsPage from './pages/SettingsPage.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/instances', name: 'instances', component: InstancesPage },
    { path: '/instances/:id', name: 'instance', component: InstanceDetailPage, props: true },
    { path: '/resources', name: 'resources', component: ResourcesPage },
    { path: '/modpacks', name: 'modpacks', component: ModpacksPage },
    { path: '/accounts', name: 'accounts', component: AccountsPage },
    { path: '/java', name: 'java', component: JavaPage },
    { path: '/settings', name: 'settings', component: SettingsPage },
  ],
})
