import { guard } from 'fuze-ai'

async function searchDocuments(query: string): Promise<string[]> {
  await new Promise(r => setTimeout(r, 200))
  return [`Result for "${query}": Document about AI safety`, `Result for "${query}": EU AI Act overview`]
}

const protectedSearch = guard(searchDocuments)

async function main() {
  console.log('Fuze AI — Basic Guard Example\n')
  const r1 = await protectedSearch('AI agent safety')
  console.log('Search 1:', r1)
  const r2 = await protectedSearch('budget enforcement')
  console.log('Search 2:', r2)
  const r3 = await protectedSearch('loop detection')
  console.log('Search 3:', r3)
  console.log('\nAll 3 calls completed.')
  console.log('Check ./fuze-traces.jsonl for the full trace.')
}

main().catch(console.error)
