import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { makeRunId, makeTenantId } from '@fuze-ai/agent'
import type { ModelMessage, SubjectRef } from '@fuze-ai/agent'
import { InMemoryMemory } from '../src/in-memory.js'
import { EncryptedMemory } from '../src/encrypted.js'
import { MemoryDecryptionError } from '../src/errors.js'

const msg = (role: ModelMessage['role'], content: string): ModelMessage => ({ role, content })

describe('EncryptedMemory', () => {
  it('roundtrips messages when read with the same key', async () => {
    const inner = new InMemoryMemory()
    const key = randomBytes(32)
    const mem = new EncryptedMemory({ inner, key })

    const tenant = makeTenantId('t1')
    const runId = makeRunId('r1')
    const messages = [msg('user', 'plaintext-question'), msg('assistant', 'plaintext-answer')]

    await mem.write({ tenant, runId, messages })
    const got = await mem.read({ tenant, runId })

    expect(got.map((m) => m.content)).toEqual(['plaintext-question', 'plaintext-answer'])
    expect(got.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('throws MemoryDecryptionError when read with the wrong key', async () => {
    const inner = new InMemoryMemory()
    const writer = new EncryptedMemory({ inner, key: randomBytes(32) })
    const reader = new EncryptedMemory({ inner, key: randomBytes(32) })

    const tenant = makeTenantId('t1')
    const runId = makeRunId('r1')
    await writer.write({ tenant, runId, messages: [msg('user', 'top-secret')] })

    await expect(reader.read({ tenant, runId })).rejects.toBeInstanceOf(MemoryDecryptionError)
  })

  it('keeps ciphertext opaque inside the inner adapter', async () => {
    const inner = new InMemoryMemory()
    const key = randomBytes(32)
    const mem = new EncryptedMemory({ inner, key })

    const tenant = makeTenantId('t1')
    const runId = makeRunId('r1')
    const secret = 'canary-string-do-not-leak'
    await mem.write({ tenant, runId, messages: [msg('user', secret)] })

    const stored = await inner.read({ tenant, runId })
    expect(stored).toHaveLength(1)
    const entry = stored[0]
    expect(entry?.role).toBe('system')
    expect(entry?.content.startsWith('encrypted:')).toBe(true)
    expect(entry?.content).not.toContain(secret)
    expect(JSON.stringify(stored)).not.toContain(secret)
  })

  it('passes erasure through to the inner adapter', async () => {
    const inner = new InMemoryMemory()
    const key = randomBytes(32)
    const mem = new EncryptedMemory({ inner, key })

    const tenant = makeTenantId('t1')
    const runId = makeRunId('r1')
    const subject: SubjectRef = { hmac: 'subj-1', scheme: 'hmac-sha256' }

    await mem.write({ tenant, runId, subjectRef: subject, messages: [msg('user', 'pii')] })
    await mem.erase(subject)

    const got = await inner.read({ tenant, runId })
    expect(got).toEqual([])
  })

  it('rejects non-32-byte keys', () => {
    const inner = new InMemoryMemory()
    expect(() => new EncryptedMemory({ inner, key: randomBytes(16) })).toThrow()
  })
})
