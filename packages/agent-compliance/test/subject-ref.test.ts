import { describe, expect, it } from 'vitest'
import { deriveSubjectRef } from '../src/subject-ref.js'

describe('deriveSubjectRef', () => {
  it('produces the same hmac for the same identifier + secret', () => {
    const a = deriveSubjectRef({ identifier: 'user-123', tenantSecret: 'secret-A' })
    const b = deriveSubjectRef({ identifier: 'user-123', tenantSecret: 'secret-A' })
    expect(a.hmac).toBe(b.hmac)
  })

  it('produces a different hmac when the tenant secret changes', () => {
    const a = deriveSubjectRef({ identifier: 'user-123', tenantSecret: 'secret-A' })
    const b = deriveSubjectRef({ identifier: 'user-123', tenantSecret: 'secret-B' })
    expect(a.hmac).not.toBe(b.hmac)
  })

  it('produces a different hmac when the identifier changes', () => {
    const a = deriveSubjectRef({ identifier: 'user-1', tenantSecret: 'secret-A' })
    const b = deriveSubjectRef({ identifier: 'user-2', tenantSecret: 'secret-A' })
    expect(a.hmac).not.toBe(b.hmac)
  })

  it('returns the expected shape with hex hmac and the hmac-sha256 scheme', () => {
    const ref = deriveSubjectRef({ identifier: 'subject@example.com', tenantSecret: 'k' })
    expect(ref.scheme).toBe('hmac-sha256')
    expect(ref.hmac).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts a Buffer secret and matches the equivalent string secret', () => {
    const stringRef = deriveSubjectRef({ identifier: 'x', tenantSecret: 'binary-secret' })
    const bufferRef = deriveSubjectRef({
      identifier: 'x',
      tenantSecret: Buffer.from('binary-secret', 'utf8'),
    })
    expect(bufferRef.hmac).toBe(stringRef.hmac)
  })
})
