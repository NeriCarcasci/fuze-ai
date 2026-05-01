import type { SecretRef, SecretsHandle } from '../types/secrets.js'

export const inMemorySecrets = (store: Readonly<Record<string, string>>): SecretsHandle => ({
  ref(id: string): SecretRef {
    if (!(id in store)) {
      throw new Error(`secret not found: ${id}`)
    }
    return { id, '__brand': 'SecretRef' } as unknown as SecretRef
  },
  async resolve(ref: SecretRef): Promise<string> {
    const id = (ref as unknown as { id: string }).id
    const value = store[id]
    if (value === undefined) throw new Error(`secret not found: ${id}`)
    return value
  },
})
