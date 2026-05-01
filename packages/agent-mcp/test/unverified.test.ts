import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DEFAULT_RETENTION, Ok, type ThreatBoundary } from '@fuze-ai/agent'
import { unverifiedTool, UnverifiedToolError } from '../src/unverified.js'
import type { UnverifiedToolMetadata } from '../src/types.js'

const tb: ThreatBoundary = {
  trustedCallers: ['mcp-host'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const baseInvoke = async () => Ok('result')

describe('unverifiedTool', () => {
  it('returns a valid PublicTool when classification is public', () => {
    const meta: UnverifiedToolMetadata = {
      dataClassification: 'public',
      retention: DEFAULT_RETENTION,
      threatBoundary: tb,
    }
    const tool = unverifiedTool({
      name: 'echo',
      description: 'echoes input',
      inputSchema: z.object({ msg: z.string() }),
      metadata: meta,
      invoke: baseInvoke,
    })
    expect(tool.dataClassification).toBe('public')
    expect(tool.name).toBe('echo')
  })

  it('throws when personal classification is missing lawful bases', () => {
    const meta: UnverifiedToolMetadata = {
      dataClassification: 'personal',
      retention: DEFAULT_RETENTION,
      threatBoundary: tb,
    }
    expect(() =>
      unverifiedTool({
        name: 'lookup-user',
        description: 'looks up a user',
        metadata: meta,
        invoke: baseInvoke,
      }),
    ).toThrow(UnverifiedToolError)
  })

  it('throws when special-category is missing art9Basis', () => {
    const meta: UnverifiedToolMetadata = {
      dataClassification: 'special-category',
      retention: DEFAULT_RETENTION,
      threatBoundary: tb,
      lawfulBases: ['consent'],
    }
    try {
      unverifiedTool({
        name: 'health-record',
        description: 'fetches a health record',
        metadata: meta,
        invoke: baseInvoke,
      })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(UnverifiedToolError)
      expect((e as UnverifiedToolError).code).toBe('missing_art9_basis')
    }
  })

  it('returns a valid SpecialCategoryTool when all metadata present', () => {
    const meta: UnverifiedToolMetadata = {
      dataClassification: 'special-category',
      retention: DEFAULT_RETENTION,
      threatBoundary: tb,
      lawfulBases: ['consent'],
      art9Basis: 'explicit-consent',
    }
    const tool = unverifiedTool({
      name: 'health-record',
      description: 'fetches a health record',
      metadata: meta,
      invoke: baseInvoke,
    })
    expect(tool.dataClassification).toBe('special-category')
    if (tool.dataClassification === 'special-category') {
      expect(tool.art9Basis).toBe('explicit-consent')
      expect(tool.residencyRequired).toBe('eu')
    }
  })
})
