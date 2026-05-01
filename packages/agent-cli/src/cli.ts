import { parseArgs } from 'node:util'
import { ApiClient, type ApiClientOptions } from './api-client.js'
import { runHealthCommand, type CommandResult } from './commands/health.js'
import { runAuditQueryCommand } from './commands/audit-query.js'
import { runAuditReplayCommand } from './commands/audit-replay.js'
import { runAuditVerifyCommand } from './commands/audit-verify.js'
import { runApproveCommand } from './commands/approve.js'
import { runDpiaCommand } from './commands/dpia.js'
import { runAnnexIvCommand } from './commands/annex-iv.js'
import { runSovereignInitCommand } from './commands/sovereign-init.js'
import { runSovereignVerifyCommand } from './commands/sovereign-verify.js'

const HELP = `fuze — Fuze Agent operator/auditor CLI

Usage:
  fuze health
  fuze audit query --subject <hmac> --tenant <id> [--since <date>]
  fuze audit replay <runId>
  fuze audit verify <runId>
  fuze approve <runId> --action approve|reject|halt|override --rationale "..." --overseer <id>
  fuze dpia <agent-definition.json>
  fuze annex-iv <agent-definition.json> --records <file.jsonl> [--mapping commission|iso-42001]
  fuze sovereign init --cloud hetzner|scaleway|ovh|aws --tenant <id> --output-dir <path>
                      [--region <r>] [--kms-provider <p>] [--kms-key-id <id>]
                      [--wg-pubkey <key> ...] [--model-provider <domain> ...]
  fuze sovereign verify --terraform-dir <path> [--json]

Global options:
  --base-url <url>       API base URL (default: $FUZE_API_URL or http://localhost:8080)
  --api-key <key>        API bearer (default: $FUZE_API_KEY)
  --json                 emit JSON instead of tabular output
`

export interface CliEnv {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly clientOptions?: ApiClientOptions
  readonly client?: ApiClient
}

const buildClientOptions = (
  parsed: { 'base-url'?: string; 'api-key'?: string },
  env: Readonly<Record<string, string | undefined>>,
): ApiClientOptions => {
  const baseUrl = parsed['base-url'] ?? env['FUZE_API_URL'] ?? 'http://localhost:8080'
  const apiKey = parsed['api-key'] ?? env['FUZE_API_KEY'] ?? ''
  return { baseUrl, apiKey }
}

export const dispatch = async (argv: readonly string[], envOpts: CliEnv = {}): Promise<CommandResult> => {
  const env = envOpts.env ?? process.env
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { exitCode: 0, stdout: HELP, stderr: '' }
  }
  const cmd = argv[0]

  if (cmd === 'health') {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        'base-url': { type: 'string' },
        'api-key': { type: 'string' },
        json: { type: 'boolean' },
      },
      strict: true,
    })
    const clientOptions = envOpts.clientOptions ?? buildClientOptions(values, env)
    return runHealthCommand({
      ...(envOpts.client ? { client: envOpts.client } : { clientOptions }),
      json: values.json === true,
    })
  }

  if (cmd === 'audit') {
    const sub = argv[1]
    const rest = argv.slice(2)
    if (sub === 'query') {
      const { values } = parseArgs({
        args: rest,
        options: {
          subject: { type: 'string' },
          tenant: { type: 'string' },
          since: { type: 'string' },
          'base-url': { type: 'string' },
          'api-key': { type: 'string' },
          json: { type: 'boolean' },
        },
        strict: true,
      })
      const clientOptions = envOpts.clientOptions ?? buildClientOptions(values, env)
      return runAuditQueryCommand({
        ...(envOpts.client ? { client: envOpts.client } : { clientOptions }),
        subject: values.subject ?? '',
        tenant: values.tenant ?? '',
        ...(values.since !== undefined ? { since: values.since } : {}),
        json: values.json === true,
      })
    }
    if (sub === 'replay' || sub === 'verify') {
      const runId = rest[0] ?? ''
      const { values } = parseArgs({
        args: rest.slice(1),
        options: {
          'base-url': { type: 'string' },
          'api-key': { type: 'string' },
          json: { type: 'boolean' },
          interactive: { type: 'boolean' },
        },
        strict: true,
      })
      const clientOptions = envOpts.clientOptions ?? buildClientOptions(values, env)
      const clientArg = envOpts.client ? { client: envOpts.client } : { clientOptions }
      if (sub === 'replay') {
        return runAuditReplayCommand({
          ...clientArg,
          runId,
          json: values.json === true,
          interactive: values.interactive === true,
        })
      }
      return runAuditVerifyCommand({ ...clientArg, runId, json: values.json === true })
    }
    return { exitCode: 1, stdout: '', stderr: `fuze: unknown audit subcommand "${sub ?? ''}"\n` }
  }

  if (cmd === 'approve') {
    const runId = argv[1] ?? ''
    const { values } = parseArgs({
      args: argv.slice(2),
      options: {
        action: { type: 'string' },
        rationale: { type: 'string' },
        overseer: { type: 'string' },
        'base-url': { type: 'string' },
        'api-key': { type: 'string' },
        json: { type: 'boolean' },
      },
      strict: true,
    })
    const clientOptions = envOpts.clientOptions ?? buildClientOptions(values, env)
    return runApproveCommand({
      ...(envOpts.client ? { client: envOpts.client } : { clientOptions }),
      runId,
      action: values.action ?? '',
      rationale: values.rationale ?? '',
      overseer: values.overseer ?? '',
      json: values.json === true,
    })
  }

  if (cmd === 'dpia') {
    const path = argv[1] ?? ''
    return runDpiaCommand({ agentDefinitionPath: path })
  }

  if (cmd === 'annex-iv') {
    const path = argv[1] ?? ''
    const { values } = parseArgs({
      args: argv.slice(2),
      options: {
        records: { type: 'string' },
        mapping: { type: 'string' },
      },
      strict: true,
    })
    const mapping =
      values.mapping === 'iso-42001' ? 'iso-42001' : values.mapping === 'commission' ? 'commission' : undefined
    return runAnnexIvCommand({
      agentDefinitionPath: path,
      recordsPath: values.records ?? '',
      ...(mapping !== undefined ? { mapping } : {}),
    })
  }

  if (cmd === 'sovereign') {
    const sub = argv[1]
    const rest = argv.slice(2)
    if (sub === 'init') {
      const { values } = parseArgs({
        args: rest,
        options: {
          cloud: { type: 'string' },
          tenant: { type: 'string' },
          'output-dir': { type: 'string' },
          region: { type: 'string' },
          'kms-provider': { type: 'string' },
          'kms-key-id': { type: 'string' },
          'wg-pubkey': { type: 'string', multiple: true },
          'model-provider': { type: 'string', multiple: true },
        },
        strict: true,
      })
      return runSovereignInitCommand({
        cloud: values.cloud ?? '',
        tenant: values.tenant ?? '',
        outputDir: values['output-dir'] ?? '',
        ...(values.region !== undefined ? { region: values.region } : {}),
        ...(values['kms-provider'] !== undefined ? { kmsProvider: values['kms-provider'] } : {}),
        ...(values['kms-key-id'] !== undefined ? { kmsKeyId: values['kms-key-id'] } : {}),
        ...(values['wg-pubkey'] !== undefined ? { operatorWgPubkeys: values['wg-pubkey'] } : {}),
        ...(values['model-provider'] !== undefined
          ? { modelProviders: values['model-provider'] }
          : {}),
      })
    }
    if (sub === 'verify') {
      const { values } = parseArgs({
        args: rest,
        options: {
          'terraform-dir': { type: 'string' },
          json: { type: 'boolean' },
        },
        strict: true,
      })
      return runSovereignVerifyCommand({
        terraformDir: values['terraform-dir'] ?? '',
        json: values.json === true,
      })
    }
    return {
      exitCode: 1,
      stdout: '',
      stderr: `fuze: unknown sovereign subcommand "${sub ?? ''}"\n`,
    }
  }

  return { exitCode: 1, stdout: '', stderr: `fuze: unknown command "${cmd}"\n${HELP}` }
}

export const main = async (argv: readonly string[]): Promise<void> => {
  try {
    const result = await dispatch(argv)
    if (result.stdout.length > 0) process.stdout.write(result.stdout)
    if (result.stderr.length > 0) process.stderr.write(result.stderr)
    process.exit(result.exitCode)
  } catch (err) {
    process.stderr.write(`fuze: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}
