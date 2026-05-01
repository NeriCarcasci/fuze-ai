import { z, type ZodType } from 'zod'
import {
  defineTool,
  Err,
  Ok,
  type FuzeTool,
  type PersonalTool,
  type PublicTool,
  type Result,
  type Retryable,
  type SpecialCategoryTool,
} from '@fuze-ai/agent'
import type { UnverifiedToolMetadata } from './types.js'

export class UnverifiedToolError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'UnverifiedToolError'
    this.code = code
  }
}

export interface UnverifiedToolSpec {
  readonly name: string
  readonly description: string
  readonly inputSchema?: ZodType<unknown>
  readonly outputSchema?: ZodType<unknown>
  readonly metadata: UnverifiedToolMetadata
  readonly invoke: (input: unknown) => Promise<Result<unknown, Retryable | Error>>
}

const isAllowedPersonalBasis = (b: string): boolean =>
  b === 'consent' ||
  b === 'contract' ||
  b === 'legal-obligation' ||
  b === 'vital-interests' ||
  b === 'public-task' ||
  b === 'legitimate-interests'

export const unverifiedTool = (spec: UnverifiedToolSpec): FuzeTool<unknown, unknown, unknown> => {
  const { metadata, name, description } = spec
  const input: ZodType<unknown> = spec.inputSchema ?? z.unknown()
  const output: ZodType<unknown> = spec.outputSchema ?? z.unknown()

  const run = async (
    raw: unknown,
  ): Promise<Result<unknown, Retryable | Error>> => {
    const parsed = input.safeParse(raw)
    if (!parsed.success) {
      return Err(new Error(`unverified tool ${name}: input validation failed`))
    }
    return spec.invoke(parsed.data)
  }

  if (metadata.dataClassification === 'public') {
    const tool: PublicTool<unknown, unknown, unknown> = defineTool.public<unknown, unknown, unknown>({
      name,
      description,
      input,
      output,
      threatBoundary: metadata.threatBoundary,
      retention: metadata.retention,
      run,
    })
    return tool
  }

  if (
    metadata.dataClassification === 'personal' ||
    metadata.dataClassification === 'business'
  ) {
    if (!metadata.lawfulBases || metadata.lawfulBases.length === 0) {
      throw new UnverifiedToolError(
        'missing_lawful_basis',
        `unverified tool ${name}: ${metadata.dataClassification} classification requires at least one GDPR lawful basis`,
      )
    }
    for (const b of metadata.lawfulBases) {
      if (!isAllowedPersonalBasis(b)) {
        throw new UnverifiedToolError(
          'invalid_lawful_basis',
          `unverified tool ${name}: lawful basis '${b}' is not a recognized GDPR Art.6 basis`,
        )
      }
    }
    const residency = metadata.residencyRequired ?? 'eu'
    const tool: PersonalTool<unknown, unknown, unknown> =
      metadata.dataClassification === 'business'
        ? defineTool.business<unknown, unknown, unknown>({
            name,
            description,
            input,
            output,
            threatBoundary: metadata.threatBoundary,
            retention: metadata.retention,
            residencyRequired: residency,
            allowedLawfulBases: metadata.lawfulBases,
            run,
          })
        : defineTool.personal<unknown, unknown, unknown>({
            name,
            description,
            input,
            output,
            threatBoundary: metadata.threatBoundary,
            retention: metadata.retention,
            residencyRequired: residency,
            allowedLawfulBases: metadata.lawfulBases,
            run,
          })
    return tool
  }

  if (metadata.dataClassification === 'special-category') {
    if (!metadata.art9Basis) {
      throw new UnverifiedToolError(
        'missing_art9_basis',
        `unverified tool ${name}: special-category classification requires an Art.9 basis`,
      )
    }
    if (!metadata.lawfulBases || metadata.lawfulBases.length === 0) {
      throw new UnverifiedToolError(
        'missing_lawful_basis',
        `unverified tool ${name}: special-category classification requires at least one Art.6 lawful basis alongside the Art.9 basis`,
      )
    }
    const tool: SpecialCategoryTool<unknown, unknown, unknown> =
      defineTool.specialCategory<unknown, unknown, unknown>({
        name,
        description,
        input,
        output,
        threatBoundary: metadata.threatBoundary,
        retention: metadata.retention,
        allowedLawfulBases: metadata.lawfulBases,
        art9Basis: metadata.art9Basis,
        run,
      })
    return tool
  }

  throw new UnverifiedToolError(
    'unknown_classification',
    `unverified tool ${name}: unknown dataClassification`,
  )
}

export const _testHelpers = { Ok, Err }
