import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { guard } from 'fuze-ai'

// Real operation: reads a file and returns a content summary with hash.
async function searchDocuments(query: string): Promise<{ file: string; size: number; hash: string }[]> {
  // Search the packages/core/src directory for files matching the query
  const srcDir = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src')
  const files = readdirSync(srcDir).filter(f => f.endsWith('.ts'))
  const matches = files
    .filter(f => f.toLowerCase().includes(query.toLowerCase()) || query === '*')
    .slice(0, 3)

  return matches.map(file => {
    const content = readFileSync(join(srcDir, file), 'utf-8')
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 12)
    return { file, size: content.length, hash }
  })
}

const protectedSearch = guard(searchDocuments)

async function main() {
  console.log('Fuze AI -- Basic Guard Example\n')

  console.log('Searching core source files with guard() protection...\n')

  const r1 = await protectedSearch('guard')
  console.log('Search "guard":', r1)

  const r2 = await protectedSearch('budget')
  console.log('Search "budget":', r2)

  const r3 = await protectedSearch('loop')
  console.log('Search "loop":', r3)

  console.log('\nAll 3 guarded calls completed.')
  console.log('Each call was traced with timing, args hash, and cost info.')
  console.log('Check ./fuze-traces.jsonl for the full trace.')
}

main().catch(console.error)
