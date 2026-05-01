export interface AuthContext {
  readonly tenantId: string
  readonly principalId: string
}

export type AuthResult =
  | { readonly ok: true; readonly context: AuthContext }
  | { readonly ok: false; readonly status: 401 | 403; readonly message: string }

export interface Auth {
  authenticate(headers: Headers): Promise<AuthResult>
}

export interface BearerAuthEntry {
  readonly tenantId: string
  readonly principalId: string
}

export class BearerAuth implements Auth {
  constructor(private readonly keys: ReadonlyMap<string, BearerAuthEntry>) {}

  async authenticate(headers: Headers): Promise<AuthResult> {
    const header = headers.get('authorization')
    if (!header) {
      return { ok: false, status: 401, message: 'missing authorization header' }
    }
    const match = /^Bearer (.+)$/.exec(header)
    if (!match || !match[1]) {
      return { ok: false, status: 401, message: 'invalid authorization scheme' }
    }
    const entry = this.keys.get(match[1])
    if (!entry) {
      return { ok: false, status: 403, message: 'unknown api key' }
    }
    return { ok: true, context: { tenantId: entry.tenantId, principalId: entry.principalId } }
  }
}

export class AllowAllAuth implements Auth {
  async authenticate(_headers: Headers): Promise<AuthResult> {
    return {
      ok: true,
      context: { tenantId: 'public', principalId: 'anonymous' },
    }
  }
}
