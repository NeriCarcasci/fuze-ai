export class KmsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KmsUnavailableError'
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CircuitOpenError'
  }
}
