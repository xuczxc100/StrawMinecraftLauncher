import { join } from 'node:path'

/** Filesystem layout under the SMCL data root. */
export class SmclPaths {
  constructor(readonly root: string) {}

  get config() {
    return join(this.root, 'config.json')
  }

  get accounts() {
    return join(this.root, 'accounts.json')
  }

  get javaIndex() {
    return join(this.root, 'java.json')
  }

  /** Shared Minecraft root: versions/, libraries/, assets/. */
  get minecraft() {
    return join(this.root, 'minecraft')
  }

  get instances() {
    return join(this.root, 'instances')
  }

  instance(id: string) {
    return join(this.instances, id)
  }

  instanceConfig(id: string) {
    return join(this.instance(id), 'instance.json')
  }

  instanceMeta(id: string) {
    return join(this.instance(id), '.smcl')
  }

  get javaRuntimes() {
    return join(this.root, 'java')
  }

  get cache() {
    return join(this.root, 'cache')
  }

  get temp() {
    return join(this.root, 'temp')
  }
}
