import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { JsonRpcMessage } from './types.js'

/**
 * Manages the real MCP server as a child process.
 *
 * The bridge spawns the server and establishes stdio pipes:
 * - stdin  → proxy writes messages TO the server
 * - stdout → proxy reads messages FROM the server
 * - stderr → inherited (server errors visible in proxy's terminal)
 */
export class MCPBridge {
  private child: ChildProcess | null = null
  private messageHandler: ((msg: JsonRpcMessage) => void) | null = null
  private exitHandler: ((code: number | null, signal: string | null) => void) | null = null

  constructor(
    private readonly command: string,
    private readonly args: string[],
  ) {}

  /**
   * Spawn the real server process and begin reading its stdout.
   * Resolves once the process is running.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'inherit'],
        shell: false,
      })

      this.child.on('error', (err) => {
        reject(err)
      })

      const rl = createInterface({
        input: this.child.stdout!,
        crlfDelay: Infinity,
      })

      rl.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        try {
          const msg = JSON.parse(trimmed) as JsonRpcMessage
          this.messageHandler?.(msg)
        } catch {
          process.stderr.write(
            `[fuze] Non-JSON from server, skipping: ${trimmed.slice(0, 100)}\n`,
          )
        }
      })

      this.child.on('exit', (code, signal) => {
        this.exitHandler?.(code, signal as string | null)
      })

      // Resolve once the spawn event loop tick completes — the process is running
      setImmediate(resolve)
    })
  }

  /**
   * Write a JSON-RPC message to the server's stdin.
   */
  sendToServer(message: JsonRpcMessage): void {
    if (!this.child?.stdin || !this.isAlive()) return
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  /**
   * Register a handler for messages received from the server.
   */
  onServerMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler
  }

  /**
   * Register a handler for server process exit.
   */
  onServerExit(
    handler: (code: number | null, signal: string | null) => void,
  ): void {
    this.exitHandler = handler
  }

  /**
   * Send SIGTERM; after 3 s send SIGKILL if still alive.
   */
  async stop(): Promise<void> {
    if (!this.child || !this.isAlive()) return

    this.child.kill('SIGTERM')

    return new Promise((resolve) => {
      const killer = setTimeout(() => {
        if (this.isAlive()) this.child!.kill('SIGKILL')
        resolve()
      }, 3_000)

      this.child!.once('exit', () => {
        clearTimeout(killer)
        resolve()
      })
    })
  }

  /** Returns true if the server process is still running. */
  isAlive(): boolean {
    return !!(
      this.child &&
      !this.child.killed &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    )
  }
}
