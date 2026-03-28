import { describe, it, expect, vi } from 'vitest'
import { SideEffectRegistry } from '../src/side-effect-registry.js'

describe('SideEffectRegistry', () => {
  it('calls compensation function with original result on rollback', async () => {
    const registry = new SideEffectRegistry()
    const compensateFn = vi.fn()

    registry.registerCompensation('sendEmail', compensateFn)
    registry.recordSideEffect('step-1', 'sendEmail', { messageId: 'msg-123' })

    const results = await registry.rollback('step-1')

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('compensated')
    expect(results[0].escalated).toBe(false)
    expect(compensateFn).toHaveBeenCalledWith({ messageId: 'msg-123' })
  })

  it('calls compensations in reverse chronological order', async () => {
    const registry = new SideEffectRegistry()
    const callOrder: string[] = []

    registry.registerCompensation('createInvoice', () => {
      callOrder.push('createInvoice')
    })
    registry.registerCompensation('sendEmail', () => {
      callOrder.push('sendEmail')
    })

    registry.recordSideEffect('step-1', 'createInvoice', { id: 'inv-1' })
    registry.recordSideEffect('step-2', 'sendEmail', { id: 'msg-1' })

    await registry.rollback('step-1')

    // Reverse order: sendEmail first, then createInvoice
    expect(callOrder).toEqual(['sendEmail', 'createInvoice'])
  })

  it('returns escalated result when no compensation is registered', async () => {
    const registry = new SideEffectRegistry()

    registry.recordSideEffect('step-1', 'deleteFile', { path: '/tmp/foo' })

    const results = await registry.rollback('step-1')

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('no_compensation')
    expect(results[0].escalated).toBe(true)
    expect(results[0].toolName).toBe('deleteFile')
  })

  it('returns false for isSideEffect on unregistered tools', () => {
    const registry = new SideEffectRegistry()

    expect(registry.isSideEffect('search')).toBe(false)
    expect(registry.isSideEffect('analyse')).toBe(false)
  })

  it('returns true for isSideEffect on registered tools', () => {
    const registry = new SideEffectRegistry()

    registry.registerCompensation('sendEmail', () => {})

    expect(registry.isSideEffect('sendEmail')).toBe(true)
  })

  it('handles compensation function failures gracefully', async () => {
    const registry = new SideEffectRegistry()

    registry.registerCompensation('riskyAction', () => {
      throw new Error('compensation failed')
    })
    registry.recordSideEffect('step-1', 'riskyAction', { data: 'x' })

    const results = await registry.rollback('step-1')

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('failed')
    expect(results[0].escalated).toBe(true)
    expect(results[0].error).toBe('compensation failed')
  })
})
