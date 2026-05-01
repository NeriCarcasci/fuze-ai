import { randomBytes, createHash } from 'node:crypto'
import type { RunId } from '../types/brand.js'
import type {
  ResumeToken,
  SuspendedRun,
  ResumeInput,
  ResumeTokenStore,
  OversightDecision,
} from '../types/oversight.js'
import { ResumeTokenInvalidError, ResumeTokenReplayError } from '../types/oversight.js'
import type { Ed25519Signer, Ed25519Verifier } from '../types/signing.js'

const encoder = new TextEncoder()

const tokenMessage = (
  runId: RunId,
  suspendedAtSequence: number,
  chainHeadAtSuspend: string,
  nonce: string,
): Uint8Array =>
  encoder.encode(
    `fuze-resume-token|${runId}|${suspendedAtSequence}|${chainHeadAtSuspend}|${nonce}`,
  )

export const mintResumeToken = async (input: {
  readonly runId: RunId
  readonly suspendedAtSequence: number
  readonly chainHeadAtSuspend: string
  readonly signer: Ed25519Signer
}): Promise<ResumeToken> => {
  const nonce = randomBytes(16).toString('hex')
  const message = tokenMessage(
    input.runId,
    input.suspendedAtSequence,
    input.chainHeadAtSuspend,
    nonce,
  )
  const signature = await input.signer.sign(message)
  return {
    runId: input.runId,
    suspendedAtSequence: input.suspendedAtSequence,
    chainHeadAtSuspend: input.chainHeadAtSuspend,
    nonce,
    signature: Buffer.from(signature).toString('base64'),
    publicKeyId: input.signer.publicKeyId,
  }
}

export const verifyResumeToken = async (input: {
  readonly token: ResumeToken
  readonly verifier: Ed25519Verifier
  readonly nonceStore: ResumeTokenStore
}): Promise<void> => {
  const message = tokenMessage(
    input.token.runId,
    input.token.suspendedAtSequence,
    input.token.chainHeadAtSuspend,
    input.token.nonce,
  )
  const signature = Buffer.from(input.token.signature, 'base64')
  const ok = await input.verifier.verify(input.token.publicKeyId, message, signature)
  if (!ok) {
    throw new ResumeTokenInvalidError('signature verification failed')
  }
  if (await input.nonceStore.has(input.token.nonce)) {
    throw new ResumeTokenReplayError(`nonce already consumed: ${input.token.nonce}`)
  }
}

export const consumeResumeToken = async (input: {
  readonly token: ResumeToken
  readonly nonceStore: ResumeTokenStore
}): Promise<void> => {
  await input.nonceStore.consume(input.token.nonce)
}

export const buildSuspendedRun = (input: {
  readonly runId: RunId
  readonly suspendedAtSpanId: SuspendedRun['suspendedAtSpanId']
  readonly suspendedAtSequence: number
  readonly chainHeadAtSuspend: string
  readonly toolName: string
  readonly toolArgs: Readonly<Record<string, unknown>>
  readonly reason: string
  readonly resumeToken: ResumeToken
  readonly definitionFingerprint: string
}): SuspendedRun => ({
  runId: input.runId,
  suspendedAtSpanId: input.suspendedAtSpanId,
  suspendedAtSequence: input.suspendedAtSequence,
  chainHeadAtSuspend: input.chainHeadAtSuspend,
  toolName: input.toolName,
  toolArgs: input.toolArgs,
  reason: input.reason,
  resumeToken: input.resumeToken,
  definitionFingerprint: input.definitionFingerprint,
})

export const decisionFingerprint = (decision: OversightDecision): string =>
  createHash('sha256')
    .update(
      encoder.encode(
        `${decision.action}|${decision.overseerId}|${decision.trainingId ?? ''}|${decision.rationale}`,
      ),
    )
    .digest('hex')

export type { ResumeInput }
