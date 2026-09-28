import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createMinecraftProcessWatcher, launch, Version, type LaunchOption } from '@xmcl/core'
import type { InstanceConfig, LaunchLogLine, LaunchState } from '@shared/types'
import { errorMessage, SmclError } from '../util/errors'
import type { EventBus } from '../util/events'
import { Log4jLineParser, type FormattedLogLine } from '../util/log4j'
import type { SmclPaths } from '../util/paths'
import type { AccountService } from './AccountService'
import type { ConfigService } from './ConfigService'
import type { InstallService } from './InstallService'
import type { InstanceService } from './InstanceService'
import type { JavaService } from './JavaService'
import type { TaskService } from './TaskService'

const MAX_LOG_LINES = 3000
const LAUNCHER_NAME = 'SMCL'
const LAUNCHER_BRAND = 'StrawMinecraftLauncher'

/** Split a user-entered argument string, keeping quoted segments together. */
export function splitArgs(input?: string): string[] {
  if (!input) return []
  const result: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) result.push(m[1] ?? m[2] ?? m[3])
  return result
}

interface RunningGame {
  state: LaunchState
  process?: ChildProcess
  logs: LaunchLogLine[]
  /** Set when the user force-stops the game, so the non-zero exit is not reported as a crash. */
  killRequested?: boolean
}

export interface LaunchHooks {
  onGameStarted?: (instance: InstanceConfig) => void
  onAllGamesExited?: () => void
}

export class LaunchService {
  private readonly games = new Map<string, RunningGame>()

  constructor(
    private readonly paths: SmclPaths,
    private readonly config: ConfigService,
    private readonly instances: InstanceService,
    private readonly install: InstallService,
    private readonly java: JavaService,
    private readonly accounts: AccountService,
    private readonly tasks: TaskService,
    private readonly bus: EventBus,
    private readonly hooks: LaunchHooks = {},
  ) {}

  states(): LaunchState[] {
    return [...this.games.values()].map((g) => ({ ...g.state }))
  }

  logs(id: string): LaunchLogLine[] {
    return [...(this.games.get(id)?.logs ?? [])]
  }

  kill(id: string) {
    const game = this.games.get(id)
    if (game?.process && game.process.exitCode === null) {
      game.killRequested = true
      game.process.kill()
    }
  }

  /** Build the full launch options (used by `start`, exposed for tests). */
  async prepare(id: string, onLog?: (line: string) => void): Promise<LaunchOption> {
    return this.tasks.run(this.instances.get(id).name, async (task) => {
      let instance = this.instances.get(id)
      const credentials = await this.accounts.getLaunchCredentials()
      const needsInstall = !instance.versionId || !(await Version.parse(this.install.folder, instance.versionId).then(() => true, () => false))
      if (needsInstall) {
        onLog?.('Installing game version...')
        instance = await this.install.installInstance(id, task)
      }
      const versionId = instance.versionId!
      onLog?.(`Verifying ${versionId}...`)
      const resolved = await this.install.repair(versionId, task)
      const java = await this.java.ensureFor(resolved.javaVersion, task, instance.javaPath)
      onLog?.(`Java ${java.version} (${java.path})`)
      const cfg = this.config.get()
      const maxMemory = instance.maxMemory ?? cfg.defaultMaxMemory
      const option: LaunchOption = {
        gamePath: this.paths.instance(id),
        resourcePath: this.paths.minecraft,
        javaPath: java.path,
        version: resolved,
        gameProfile: { id: credentials.uuid.replace(/-/g, ''), name: credentials.name },
        accessToken: credentials.accessToken,
        userType: credentials.userType,
        launcherName: LAUNCHER_NAME,
        launcherBrand: LAUNCHER_BRAND,
        versionName: `${LAUNCHER_NAME} ${instance.name}`,
        versionType: LAUNCHER_NAME,
        maxMemory,
        minMemory: Math.min(instance.minMemory ?? Math.min(1024, maxMemory), maxMemory),
        extraJVMArgs: splitArgs(instance.jvmArgs),
        extraMCArgs: splitArgs(instance.mcArgs),
      }
      if (instance.resolution) option.resolution = { ...instance.resolution }
      if (instance.server?.host) option.server = { ip: instance.server.host, port: instance.server.port }
      return option
    })
  }

  async start(id: string): Promise<LaunchState> {
    const existing = this.games.get(id)
    if (existing && ['preparing', 'launching', 'running'].includes(existing.state.status)) {
      throw new SmclError('AlreadyRunning', 'This instance is already running')
    }
    const instance = this.instances.get(id)
    const game: RunningGame = { state: { instanceId: id, status: 'preparing', startedAt: Date.now() }, logs: [] }
    this.games.set(id, game)
    this.emitState(game)
    const log = (line: string, stream: LaunchLogLine['stream'] = 'smcl') => this.pushLog(game, stream, line)
    try {
      const option = await this.prepare(id, (line) => log(line))
      this.setStatus(game, 'launching')
      log(`Launching ${instance.name}`)
      const child = await launch({ ...option, extraExecOption: { detached: false } })
      game.process = child
      game.state.pid = child.pid
      this.pipe(game, child)
      const watcher = createMinecraftProcessWatcher(child)
      watcher.on('minecraft-window-ready', () => this.setStatus(game, 'running'))
      watcher.on('minecraft-exit', ({ code, crashReport, crashReportLocation }) => {
        game.state.exitCode = code
        if (crashReport) {
          game.state.crashReport = crashReport
          game.state.crashReportPath = crashReportLocation
        }
        this.setStatus(game, crashReport || (code !== 0 && !game.killRequested) ? 'crashed' : 'exited')
        log(`Game exited with code ${code}`)
        game.process = undefined
        if (this.states().every((s) => !['preparing', 'launching', 'running'].includes(s.status))) this.hooks.onAllGamesExited?.()
      })
      watcher.on('error', (e) => log(`Process error: ${errorMessage(e)}`, 'stderr'))
      this.setStatus(game, 'running')
      await this.instances.markPlayed(id)
      this.hooks.onGameStarted?.(instance)
      return { ...game.state }
    } catch (e) {
      game.state.error = errorMessage(e)
      log(`Launch failed: ${game.state.error}`, 'stderr')
      this.setStatus(game, 'failed')
      throw e
    }
  }

  private pipe(game: RunningGame, child: ChildProcess) {
    for (const [stream, source] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
      if (!source) continue
      source.setEncoding('utf8')
      const parser = new Log4jLineParser()
      const emit = (lines: FormattedLogLine[]) => {
        for (const l of lines) this.pushLog(game, l.error ? 'stderr' : stream, l.text)
      }
      const rl = createInterface({ input: source })
      rl.on('line', (line) => emit(parser.push(line)))
      rl.on('close', () => emit(parser.flush()))
    }
  }

  private pushLog(game: RunningGame, stream: LaunchLogLine['stream'], line: string) {
    const entry: LaunchLogLine = { instanceId: game.state.instanceId, stream, line }
    game.logs.push(entry)
    if (game.logs.length > MAX_LOG_LINES) game.logs.splice(0, game.logs.length - MAX_LOG_LINES)
    this.bus.emit('launch:log', entry)
  }

  private setStatus(game: RunningGame, status: LaunchState['status']) {
    if (game.state.status === status) return
    const terminal = ['exited', 'crashed', 'failed']
    if (terminal.includes(game.state.status) && !terminal.includes(status)) return
    game.state.status = status
    this.emitState(game)
  }

  private emitState(game: RunningGame) {
    this.bus.emit('launch:state', { ...game.state })
  }
}
