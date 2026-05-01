import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LocalKeySigner, LocalKeyVerifier } from '../src/local-key.js'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'fuze-agent-signing-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('LocalKeySigner', () => {
  it('generates a key on first use and writes it to disk', () => {
    const keyPath = path.join(workDir, 'sub', 'agent-key')
    const signer = new LocalKeySigner({ keyPath })

    expect(existsSync(keyPath)).toBe(true)
    expect(existsSync(`${keyPath}.pub`)).toBe(true)
    expect(signer.publicKeyId).toMatch(/^[0-9a-f]{16}$/)

    if (process.platform !== 'win32') {
      const mode = statSync(keyPath).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })

  it('re-instantiating with the same path loads the same keypair', () => {
    const keyPath = path.join(workDir, 'agent-key')
    const a = new LocalKeySigner({ keyPath })
    const b = new LocalKeySigner({ keyPath })
    expect(a.publicKeyId).toBe(b.publicKeyId)
    expect(a.publicKeyPem).toBe(b.publicKeyPem)
  })

  it('signs and verifies a message round-trip', async () => {
    const signer = new LocalKeySigner({ keyPath: path.join(workDir, 'agent-key') })
    const verifier = LocalKeyVerifier.fromSigner(signer)
    const message = new TextEncoder().encode('hello world')
    const sig = await signer.sign(message)
    const ok = await verifier.verify(signer.publicKeyId, message, sig)
    expect(ok).toBe(true)
  })

  it('returns false for an unregistered keyId', async () => {
    const signer = new LocalKeySigner({ keyPath: path.join(workDir, 'agent-key') })
    const verifier = new LocalKeyVerifier(new Map())
    const message = new TextEncoder().encode('hello')
    const sig = await signer.sign(message)
    const ok = await verifier.verify(signer.publicKeyId, message, sig)
    expect(ok).toBe(false)
  })

  it('returns false for a tampered signature', async () => {
    const signer = new LocalKeySigner({ keyPath: path.join(workDir, 'agent-key') })
    const verifier = LocalKeyVerifier.fromSigner(signer)
    const message = new TextEncoder().encode('hello')
    const sig = await signer.sign(message)
    const tampered = new Uint8Array(sig)
    tampered[0] = (tampered[0] ?? 0) ^ 0xff
    const ok = await verifier.verify(signer.publicKeyId, message, tampered)
    expect(ok).toBe(false)
  })

  it('returns false for a tampered message', async () => {
    const signer = new LocalKeySigner({ keyPath: path.join(workDir, 'agent-key') })
    const verifier = LocalKeyVerifier.fromSigner(signer)
    const message = new TextEncoder().encode('hello')
    const sig = await signer.sign(message)
    const tampered = new TextEncoder().encode('hellp')
    const ok = await verifier.verify(signer.publicKeyId, tampered, sig)
    expect(ok).toBe(false)
  })

  it('two distinct signers have distinct publicKeyIds', () => {
    const a = new LocalKeySigner({ keyPath: path.join(workDir, 'a', 'agent-key') })
    const b = new LocalKeySigner({ keyPath: path.join(workDir, 'b', 'agent-key') })
    expect(a.publicKeyId).not.toBe(b.publicKeyId)
  })

  it('throws when the keyPath parent cannot be created', () => {
    const blocker = path.join(workDir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    const keyPath = path.join(blocker, 'inner', 'agent-key')
    expect(() => new LocalKeySigner({ keyPath })).toThrow()
  })

  it('persists the public PEM file alongside the private key', () => {
    const keyPath = path.join(workDir, 'agent-key')
    const signer = new LocalKeySigner({ keyPath })
    const onDisk = readFileSync(`${keyPath}.pub`, 'utf8')
    expect(onDisk).toBe(signer.publicKeyPem)
    expect(onDisk).toContain('-----BEGIN PUBLIC KEY-----')
  })
})
