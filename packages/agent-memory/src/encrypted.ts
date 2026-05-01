import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type {
  FuzeMemory,
  MemoryReadInput,
  MemoryWriteInput,
  ModelMessage,
  SubjectRef,
} from '@fuze-ai/agent'
import { MemoryDecryptionError } from './errors.js'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const PREFIX = 'encrypted:'

export interface EncryptedMemoryOptions {
  readonly inner: FuzeMemory
  readonly key: Buffer
}

export class EncryptedMemory implements FuzeMemory {
  private readonly inner: FuzeMemory
  private readonly key: Buffer

  constructor(options: EncryptedMemoryOptions) {
    if (options.key.length !== 32) {
      throw new Error('EncryptedMemory requires a 32-byte key for AES-256-GCM')
    }
    this.inner = options.inner
    this.key = options.key
  }

  async read(input: MemoryReadInput): Promise<readonly ModelMessage[]> {
    const wrapped = await this.inner.read(input)
    const out: ModelMessage[] = []
    for (const msg of wrapped) {
      if (msg.role !== 'system' || !msg.content.startsWith(PREFIX)) {
        out.push(msg)
        continue
      }
      const decrypted = this.decrypt(msg.content.slice(PREFIX.length))
      const parsed = JSON.parse(decrypted) as ModelMessage[]
      for (const m of parsed) out.push(m)
    }
    return out
  }

  async write(input: MemoryWriteInput): Promise<void> {
    const plaintext = JSON.stringify(input.messages)
    const sealed = this.encrypt(plaintext)
    const wrapped: ModelMessage = {
      role: 'system',
      content: PREFIX + sealed,
    }
    const writeInput: MemoryWriteInput = {
      tenant: input.tenant,
      runId: input.runId,
      messages: [wrapped],
      ...(input.subjectRef !== undefined ? { subjectRef: input.subjectRef } : {}),
    }
    await this.inner.write(writeInput)
  }

  async erase(subjectRef: SubjectRef): Promise<void> {
    await this.inner.erase(subjectRef)
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, ciphertext]).toString('base64')
  }

  private decrypt(b64: string): string {
    let raw: Buffer
    try {
      raw = Buffer.from(b64, 'base64')
    } catch {
      throw new MemoryDecryptionError('invalid base64 in encrypted memory entry')
    }
    if (raw.length < IV_BYTES + TAG_BYTES) {
      throw new MemoryDecryptionError('encrypted memory entry shorter than iv+tag')
    }
    const iv = raw.subarray(0, IV_BYTES)
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES)
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv)
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return plain.toString('utf8')
    } catch {
      throw new MemoryDecryptionError()
    }
  }
}
