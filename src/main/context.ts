import { mkdir } from 'node:fs/promises'
import { AccountService, plainSecretStore, type SecretStore } from './services/AccountService'
import { ConfigService } from './services/ConfigService'
import { InstallService } from './services/InstallService'
import { InstanceService } from './services/InstanceService'
import { JavaService } from './services/JavaService'
import { LaunchService, type LaunchHooks } from './services/LaunchService'
import { ModpackService } from './services/ModpackService'
import { ResourceService } from './services/ResourceService'
import { TaskService } from './services/TaskService'
import { EventBus } from './util/events'
import { SmclPaths } from './util/paths'

export interface ContextOptions {
  dataRoot: string
  version: string
  secrets?: SecretStore
  launchHooks?: LaunchHooks
  env?: NodeJS.ProcessEnv
}

/** Wires every service together; independent of Electron so tests can build a full context. */
export async function createContext(options: ContextOptions) {
  const paths = new SmclPaths(options.dataRoot)
  await mkdir(paths.root, { recursive: true })
  const bus = new EventBus()
  const config = new ConfigService(paths, bus, options.env)
  await config.load()
  const tasks = new TaskService(bus)
  const accounts = new AccountService(paths, config, bus, options.secrets ?? plainSecretStore)
  const instances = new InstanceService(paths, config, bus)
  const java = new JavaService(paths, config, tasks)
  const install = new InstallService(paths, config, instances, java, tasks)
  const resources = new ResourceService(paths, config, instances, tasks, `StrawCoding/StrawMinecraftLauncher/${options.version}`)
  const modpacks = new ModpackService(paths, config, instances, install, resources, tasks)
  const launcher = new LaunchService(paths, config, instances, install, java, accounts, tasks, bus, options.launchHooks)
  await Promise.all([accounts.load(), instances.load()])
  await java.load()
  return { paths, bus, config, tasks, accounts, instances, java, install, resources, modpacks, launcher, version: options.version }
}

export type SmclContext = Awaited<ReturnType<typeof createContext>>
