export class MemoryDecryptionError extends Error {
  constructor(message = 'failed to decrypt memory entry') {
    super(message)
    this.name = 'MemoryDecryptionError'
  }
}
