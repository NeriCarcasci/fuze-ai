export type {
  TransparencyLog,
  TransparencyEntry,
  TransparencyAnchor,
  TransparencyProof,
} from './types.js'
export { TransparencyNotFoundError, TransparencyDuplicateError } from './types.js'

export { SqliteTransparencyLog, leafHashOf } from './sqlite-log.js'
export type { SqliteTransparencyLogOptions } from './sqlite-log.js'

export { RekorTransparencyLog } from './rekor-log.js'
export type { RekorTransparencyLogOptions } from './rekor-log.js'

export { migrateTransparencyLog } from './migrations.js'

export {
  buildInclusionProof,
  computeMerkleRoot,
  verifyInclusionProof,
  encodeProof,
  decodeProof,
  hashPair,
  sha256Hex,
} from './merkle.js'
export type { InclusionStep } from './merkle.js'
