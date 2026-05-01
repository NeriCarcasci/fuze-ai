import { z } from 'zod'
import {
  defineAgent,
  defineTool,
  inMemorySecrets,
  runAgent,
  StaticPolicyEngine,
  verifyChain,
  makeTenantId,
  makePrincipalId,
  Ok,
  type Ctx,
  type FuzeModel,
  type FuzeSandbox,
  type ModelStep,
  type SandboxExecInput,
  type SandboxExecOutput,
  type ThreatBoundary,
  type ChainedRecord,
  type EvidenceSpan,
} from '@fuze-ai/agent'

const publicBoundary: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: true,
  writesFilesystem: true,
}

const retention = {
  id: 'codegen.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 30,
}

class StubSandbox implements FuzeSandbox {
  readonly tier = 'vm-managed' as const
  readonly threatBoundary: ThreatBoundary = publicBoundary
  private readonly fs = new Map<string, string>([
    ['src/add.ts', 'export const add = (a: number, b: number): number => a + b\n'],
    ['package.json', '{"name":"demo","version":"1.0.0"}\n'],
  ])

  async exec(input: SandboxExecInput, _ctx: Ctx<unknown>): Promise<SandboxExecOutput> {
    const cmd = input.command.trim()
    if (cmd.startsWith('read_file ')) {
      const path = cmd.slice('read_file '.length).trim()
      const content = this.fs.get(path)
      if (content === undefined) {
        return { stdout: '', stderr: `not found: ${path}`, exitCode: 1, durationMs: 1, tier: this.tier, truncated: false }
      }
      return { stdout: content, stderr: '', exitCode: 0, durationMs: 1, tier: this.tier, truncated: false }
    }
    if (cmd.startsWith('write_file ')) {
      const path = cmd.slice('write_file '.length).trim()
      const data = input.stdin ?? ''
      this.fs.set(path, data)
      return {
        stdout: String(Buffer.byteLength(data, 'utf8')),
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        tier: this.tier,
        truncated: false,
      }
    }
    if (cmd.startsWith('npm test') || cmd === 'run_tests') {
      return {
        stdout: 'PASS  src/add.test.ts\n  add() returns sum\n\nTests: 1 passed, 1 total',
        stderr: '',
        exitCode: 0,
        durationMs: 5,
        tier: this.tier,
        truncated: false,
      }
    }
    return {
      stdout: '',
      stderr: `command not supported in stub: ${cmd}`,
      exitCode: 127,
      durationMs: 1,
      tier: this.tier,
      truncated: false,
    }
  }
}

const sandbox = new StubSandbox()

const bashTool = defineTool.public({
  name: 'bash',
  description: 'Run a shell command inside the sandbox.',
  input: z.object({ command: z.string().min(1) }),
  output: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int(),
  }),
  threatBoundary: publicBoundary,
  retention,
  run: async (input, ctx) => {
    const result = await sandbox.exec({ command: input.command }, ctx)
    return Ok({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode })
  },
})

const readFileTool = defineTool.public({
  name: 'read_file',
  description: 'Read a file from the sandbox.',
  input: z.object({ path: z.string().min(1) }),
  output: z.object({ content: z.string() }),
  threatBoundary: publicBoundary,
  retention,
  run: async (input, ctx) => {
    const result = await sandbox.exec({ command: `read_file ${input.path}` }, ctx)
    if (result.exitCode !== 0) {
      return { ok: false, error: new Error(result.stderr) }
    }
    return Ok({ content: result.stdout })
  },
})

const writeFileTool = defineTool.public({
  name: 'write_file',
  description: 'Write a file to the sandbox.',
  input: z.object({ path: z.string().min(1), content: z.string() }),
  output: z.object({ bytesWritten: z.number().int().nonnegative() }),
  threatBoundary: { ...publicBoundary, readsFilesystem: false },
  retention,
  run: async (input, ctx) => {
    const result = await sandbox.exec({ command: `write_file ${input.path}`, stdin: input.content }, ctx)
    if (result.exitCode !== 0) {
      return { ok: false, error: new Error(result.stderr) }
    }
    const parsed = Number.parseInt(result.stdout, 10)
    return Ok({ bytesWritten: Number.isFinite(parsed) && parsed >= 0 ? parsed : Buffer.byteLength(input.content, 'utf8') })
  },
})

const runTestsTool = defineTool.public({
  name: 'run_tests',
  description: 'Run the project test suite inside the sandbox.',
  input: z.object({}),
  output: z.object({ passed: z.boolean(), summary: z.string() }),
  threatBoundary: publicBoundary,
  retention,
  run: async (_input, ctx) => {
    const result = await sandbox.exec({ command: 'run_tests' }, ctx)
    return Ok({ passed: result.exitCode === 0, summary: result.stdout })
  },
})

const scriptedModel = (steps: readonly ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'codegen',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('exhausted')
      return s
    },
  }
}

export interface CodegenInput {
  readonly task: string
  readonly path: string
}

export const buildCodeGenAgent = (input: CodegenInput) =>
  defineAgent({
    purpose: 'code-generation',
    lawfulBasis: 'legitimate-interests',
    annexIIIDomain: 'none',
    producesArt22Decision: false,
    model: scriptedModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'read_file', args: { path: input.path } }],
        finishReason: 'tool_calls',
        tokensIn: 30,
        tokensOut: 10,
      },
      {
        content: '',
        toolCalls: [
          {
            id: 'c2',
            name: 'write_file',
            args: {
              path: input.path,
              content: 'export const add = (a: number, b: number): number => a + b\nexport const sub = (a: number, b: number): number => a - b\n',
            },
          },
        ],
        finishReason: 'tool_calls',
        tokensIn: 30,
        tokensOut: 30,
      },
      {
        content: '',
        toolCalls: [{ id: 'c3', name: 'run_tests', args: {} }],
        finishReason: 'tool_calls',
        tokensIn: 20,
        tokensOut: 5,
      },
      {
        content: JSON.stringify({ task: input.task, success: true }),
        toolCalls: [],
        finishReason: 'stop',
        tokensIn: 15,
        tokensOut: 10,
      },
    ]),
    tools: [bashTool, readFileTool, writeFileTool, runTestsTool],
    output: z.object({ task: z.string(), success: z.boolean() }),
    maxSteps: 8,
    retryBudget: 0,
    deps: {},
  })

export const buildPolicy = () =>
  new StaticPolicyEngine([{ id: 'allow.all', toolName: '*', effect: 'allow' }])

const main = async (): Promise<void> => {
  const records: ChainedRecord<EvidenceSpan>[] = []
  const agent = buildCodeGenAgent({ task: 'add a sub function', path: 'src/add.ts' })
  const policy = buildPolicy()

  const result = await runAgent(
    {
      definition: agent,
      policy,
      evidenceSink: (r) => {
        records.push(r)
      },
    },
    {
      tenant: makeTenantId('dev-prod'),
      principal: makePrincipalId('developer-1'),
      secrets: inMemorySecrets({}),
      userMessage: 'add a sub function to src/add.ts',
    },
  )

  console.log(
    JSON.stringify(
      {
        status: result.status,
        output: result.output,
        steps: result.steps,
        hashChainValid: verifyChain(records),
        spanCount: records.length,
      },
      null,
      2,
    ),
  )
}

const isMain = (): boolean => {
  const arg = process.argv[1]
  if (!arg) return false
  return arg.endsWith('index.ts') || arg.endsWith('index.js')
}

if (isMain()) {
  await main()
}
