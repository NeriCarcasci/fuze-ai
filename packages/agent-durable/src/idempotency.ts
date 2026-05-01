import { createHash } from 'node:crypto'
import { canonicalize } from '@fuze-ai/agent'

export function argsHash(args: unknown): string {
  return createHash('sha256').update(canonicalize(args)).digest('hex')
}

export function outputHash(output: unknown): string {
  return createHash('sha256').update(canonicalize(output)).digest('hex')
}
