/**
 * fromMarkdown — co-locate behavioral instructions and context with agent code.
 *
 * Reads a markdown file (or directory of markdown files) at module-load time,
 * hashes the content, and returns a structured object that defineAgent /
 * defineAgentRole can embed. The hash becomes part of the role/agent
 * fingerprint and is recorded in the evidence chain.
 *
 * Design: explicit paths, not auto-discovery. SDKs called from arbitrary
 * code don't have a reliable cwd anchor; silent file pickup is a foot-gun
 * for an evidence-chain tool. Every entry is auditable because the developer
 * named it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, basename, join } from 'node:path'

export interface ResolvedMarkdown {
  readonly resolved: string
  readonly sha256: string
  readonly path: string
  readonly bytes: number
}

export interface ResolvedMarkdownDir {
  readonly files: readonly ResolvedMarkdown[]
  readonly concatenatedHash: string
}

const sha256Hex = (s: string): string =>
  createHash('sha256').update(s).digest('hex')

const readAndHash = (absPath: string): ResolvedMarkdown => {
  const buf = readFileSync(absPath)
  const text = buf.toString('utf8')
  return {
    resolved: text,
    sha256: sha256Hex(text),
    path: absPath,
    bytes: buf.byteLength,
  }
}

export const fromMarkdown = (path: string, basePath?: string): ResolvedMarkdown => {
  const abs = basePath ? resolve(basePath, path) : resolve(path)
  return readAndHash(abs)
}

fromMarkdown.dir = (path: string, basePath?: string): ResolvedMarkdownDir => {
  const abs = basePath ? resolve(basePath, path) : resolve(path)
  const stat = statSync(abs)
  if (!stat.isDirectory()) {
    throw new Error(`fromMarkdown.dir: ${abs} is not a directory`)
  }
  const entries = readdirSync(abs)
    .filter((name) => name.endsWith('.md') || name.endsWith('.mdx'))
    .sort()
  const files: ResolvedMarkdown[] = entries.map((name) => readAndHash(join(abs, name)))
  const concatenated = files.map((f) => `# ${basename(f.path)}\n${f.sha256}`).join('\n')
  return {
    files,
    concatenatedHash: sha256Hex(concatenated),
  }
}

/**
 * Concatenate a directory's resolved files in lex order, with markdown
 * separators. Used by the runtime when assembling the system prompt.
 */
export const concatenateContext = (dir: ResolvedMarkdownDir): string =>
  dir.files
    .map((f) => `<!-- ${basename(f.path)} sha256:${f.sha256.slice(0, 12)} -->\n${f.resolved}`)
    .join('\n\n')
