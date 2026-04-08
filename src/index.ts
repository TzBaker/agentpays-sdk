/**
 * AgentPays SDK v2
 *
 * TypeScript-first client for AI agents to request payments via AgentPays.
 * Works in Node.js, Deno, Bun, and Edge runtimes (no Node-only dependencies).
 *
 * Quick start:
 *   const pay = AgentPays.fromEnv()                     // reads AGENTPAYS_AGENT_ID + AGENTPAYS_API_KEY
 *   const ok  = await pay.canSpend({ amount: 5, currency: 'USDC', chain: 'BASE', action: 'PAY_API' })
 *   if (ok.approved) {
 *     const result = await pay.spend({ ..., idempotencyKey: 'my-unique-op-id' })
 *   }
 */

// ─── Error codes ─────────────────────────────────────────────────────────────

export type SpendErrorCode =
  | 'LIMIT_REACHED'
  | 'AGENT_PAUSED'
  | 'AGENT_REVOKED'
  | 'CHAIN_NOT_ALLOWED'
  | 'CURRENCY_NOT_ALLOWED'
  | 'NO_WALLET'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'EXECUTION_FAILED'
  | 'INSUFFICIENT_GAS'
  | 'INSUFFICIENT_BALANCE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'

// ─── Core types ───────────────────────────────────────────────────────────────

export type Action = 'SWAP' | 'PAY_API' | 'SEND' | 'MINT' | 'DEPOSIT'

export interface SpendParams {
  amount: number
  currency: string
  chain: string
  action: Action
  memo?: string
  /** Arbitrary context for your own logging / AI traces */
  context?: string
  metadata?: Record<string, unknown>
  /**
   * Idempotency key — pass a stable unique string (e.g. task ID) to safely
   * retry on network failure without double-spending. De-duped for 24 hours.
   */
  idempotencyKey?: string
}

/** Discriminated union — check `approved` first */
export type SpendResult =
  | {
      approved: true
      txId: string
      txHash?: string
      remainingBudget?: number
      /** 'vault' if executed through on-chain vault, 'direct' for legacy mode */
      spendMode?: 'vault' | 'direct'
      /** Vault contract address (set when spendMode='vault') */
      vaultAddress?: string
    }
  | {
      approved: false
      txId: string
      reason: string
      /** Machine-readable denial code */
      code: SpendErrorCode
      /** True = you can retry after waiting (rate limit / period reset) */
      retryable: boolean
    }

export interface CanSpendParams {
  amount: number
  currency: string
  chain: string
  action: Action
  memo?: string
  context?: string
  metadata?: Record<string, unknown>
}

export type CanSpendResult =
  | { approved: true; remainingBudget?: number }
  | { approved: false; reason: string; code: SpendErrorCode; retryable: boolean }

export interface BalanceEntry {
  currency: string
  amount: number
  usdValue?: number
}

export interface WalletInfo {
  walletId: string
  walletName: string
  walletAddress: string
  chain: { chainId: number; name: string; shortName: string }
  periodType: string
  periodReset: string
  currencies: Array<{
    symbol: string
    name: string
    contractAddress: string | null
    decimals: number
    spendLimit: number
    spentThisPeriod: number
    remainingBudget: number
  }>
}

export interface PolicyResult {
  agentId: string
  agentName: string
  status: string
  wallets: WalletInfo[]
}

export interface TransactionRecord {
  id: string
  agentId: string | null
  action: string
  amount: number
  currency: string
  chain: string
  txHash: string | null
  status: 'APPROVED' | 'DENIED' | 'PENDING' | 'CONFIRMED' | 'FAILED'
  reason: string | null
  metadata: unknown
  createdAt: string
  spendMode?: string | null
  vaultAddress?: string | null
}

// ─── Operator vault types ─────────────────────────────────────────────────────

export interface VaultInfo {
  id: string
  chainId: number
  vaultAddress: string
  isActive: boolean
  lastSyncedAt: string | null
  deployedAt: string
}

export interface VaultBalance {
  symbol: string
  tokenAddress: string | null
  balance: number
  balanceRaw: string
  decimals: number
}

// ─── SDK options ──────────────────────────────────────────────────────────────

export interface AgentPaysOptions {
  agentId: string
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
  /** Log request/response details to console (never logs the API key) */
  debug?: boolean
  /**
   * Retry config for transient errors (network failures, 5xx, rate limits).
   * Set retries: 0 to disable.
   */
  retries?: number
  retryDelayMs?: number
}

// ─── SDK class ────────────────────────────────────────────────────────────────

export class AgentPays {
  private readonly agentId: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly debug: boolean
  private readonly retries: number
  private readonly retryDelayMs: number

  constructor(opts: AgentPaysOptions) {
    if (!opts.agentId) throw new Error('AgentPays: agentId is required')
    if (!opts.apiKey)  throw new Error('AgentPays: apiKey is required')

    this.agentId      = opts.agentId
    this.apiKey       = opts.apiKey
    this.baseUrl      = (opts.baseUrl ?? 'https://agentpays.app').replace(/\/$/, '')
    this.timeoutMs    = opts.timeoutMs ?? 30_000
    this.debug        = opts.debug ?? false
    this.retries      = opts.retries ?? 2
    this.retryDelayMs = opts.retryDelayMs ?? 500
  }

  /**
   * Initialise from environment variables.
   *   AGENTPAYS_AGENT_ID — required
   *   AGENTPAYS_API_KEY  — required
   *   AGENTPAYS_BASE_URL — optional (default: https://agentpays.app)
   *   AGENTPAYS_DEBUG    — optional ("true" / "1")
   */
  static fromEnv(overrides?: Partial<AgentPaysOptions>): AgentPays {
    const agentId = overrides?.agentId ?? process.env.AGENTPAYS_AGENT_ID ?? ''
    const apiKey  = overrides?.apiKey  ?? process.env.AGENTPAYS_API_KEY  ?? ''
    const baseUrl = overrides?.baseUrl ?? process.env.AGENTPAYS_BASE_URL
    const debug   = overrides?.debug   ?? (process.env.AGENTPAYS_DEBUG === 'true' || process.env.AGENTPAYS_DEBUG === '1')

    if (!agentId) throw new Error('AgentPays.fromEnv: AGENTPAYS_AGENT_ID env var is required')
    if (!apiKey)  throw new Error('AgentPays.fromEnv: AGENTPAYS_API_KEY env var is required')

    return new AgentPays({ agentId, apiKey, baseUrl, debug, ...overrides })
  }

  // ─── Static helpers ─────────────────────────────────────────────────────────

  /** Basic Ethereum address validation */
  static isValidAddress(address: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(address)
  }

  // ─── Core methods ────────────────────────────────────────────────────────────

  /**
   * Dry-run policy check — verifies whether a spend would be approved
   * WITHOUT consuming budget. Safe to call repeatedly.
   *
   * @example
   * const check = await pay.canSpend({ amount: 5, currency: 'USDC', chain: 'BASE', action: 'PAY_API' })
   * if (!check.approved) console.log('Would be denied:', check.reason)
   */
  async canSpend(params: CanSpendParams): Promise<CanSpendResult> {
    const res = await this._fetch('/api/spend/check', {
      method: 'POST',
      body: JSON.stringify({ agentId: this.agentId, ...params }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>
      return {
        approved: false,
        reason: String(err.error ?? `HTTP ${res.status}`),
        code: (err.code as SpendErrorCode) ?? 'INTERNAL_ERROR',
        retryable: false,
      }
    }

    const data = await res.json() as {
      approved: boolean; reason?: string; code?: SpendErrorCode;
      retryable?: boolean; remainingBudget?: number
    }

    if (!data.approved) {
      return {
        approved: false,
        reason: data.reason ?? 'Denied',
        code: data.code ?? 'INTERNAL_ERROR',
        retryable: data.retryable ?? false,
      }
    }
    return { approved: true, remainingBudget: data.remainingBudget }
  }

  /**
   * Request a payment. The AgentPays Policy Engine will approve or deny
   * based on the operator's configured rules.
   *
   * Pass `idempotencyKey` (a stable unique string for this operation) to safely
   * retry on network failure — the server de-dupes for 24 hours.
   *
   * @example
   * const result = await pay.spend({
   *   amount: 5,
   *   currency: 'USDC',
   *   chain: 'BASE',
   *   action: 'PAY_API',
   *   memo: 'OpenWeather API call',
   *   idempotencyKey: `weather-${taskId}`,
   * })
   * if (result.approved) { ... } else { console.log(result.reason, result.code) }
   */
  async spend(params: SpendParams): Promise<SpendResult> {
    const res = await this._fetch('/api/spend/request', {
      method: 'POST',
      body: JSON.stringify({ agentId: this.agentId, ...params }),
      retryable: true,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>
      return {
        approved: false,
        txId: '',
        reason: String(err.error ?? `HTTP ${res.status}`),
        code: (err.code as SpendErrorCode) ?? 'INTERNAL_ERROR',
        retryable: res.status === 429 || res.status >= 500,
      }
    }

    const data = await res.json() as {
      approved: boolean; txId: string; txHash?: string; reason?: string;
      code?: SpendErrorCode; retryable?: boolean; remainingBudget?: number;
      spendMode?: string; vaultAddress?: string
    }

    if (!data.approved) {
      return {
        approved: false,
        txId: data.txId ?? '',
        reason: data.reason ?? 'Denied',
        code: data.code ?? 'INTERNAL_ERROR',
        retryable: data.retryable ?? false,
      }
    }
    return {
      approved: true,
      txId: data.txId,
      txHash: data.txHash,
      remainingBudget: data.remainingBudget,
      spendMode: data.spendMode as 'vault' | 'direct' | undefined,
      vaultAddress: data.vaultAddress,
    }
  }

  /**
   * Fetch the agent's current spend policy: wallets, currencies, limits, and
   * remaining budgets for the current period.
   */
  async getPolicy(): Promise<PolicyResult> {
    const res = await this._fetch(`/api/agents/${this.agentId}/policy`)
    if (!res.ok) throw new Error(`getPolicy failed: HTTP ${res.status}`)
    return res.json() as Promise<PolicyResult>
  }

  /**
   * Fetch the agent's own status and metadata.
   */
  async getStatus(): Promise<{ id: string; name: string; status: string; description: string | null }> {
    const res = await this._fetch(`/api/agents/${this.agentId}/status`)
    if (!res.ok) throw new Error(`getStatus failed: HTTP ${res.status}`)
    return res.json() as Promise<{ id: string; name: string; status: string; description: string | null }>
  }

  /**
   * Fetch a transaction by ID. Useful for polling confirmation after a SEND.
   *
   * @example
   * const result = await pay.spend({ action: 'SEND', ... })
   * if (result.approved) {
   *   const tx = await pay.getTransaction(result.txId)
   *   console.log(tx.status) // 'CONFIRMED' | 'FAILED' | 'PENDING' ...
   * }
   */
  async getTransaction(txId: string): Promise<TransactionRecord> {
    const res = await this._fetch(`/api/transactions/${txId}`)
    if (!res.ok) throw new Error(`getTransaction failed: HTTP ${res.status}`)
    return res.json() as Promise<TransactionRecord>
  }

  /**
   * Poll a transaction until it reaches a terminal state (CONFIRMED or FAILED).
   * Rejects if `timeoutMs` elapses without settling.
   *
   * @example
   * const result = await pay.spend({ action: 'SEND', ... })
   * if (result.approved) {
   *   const tx = await pay.waitForTransaction(result.txId, { timeoutMs: 60_000 })
   *   console.log(tx.status, tx.txHash)
   * }
   */
  async waitForTransaction(
    txId: string,
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<TransactionRecord> {
    const interval = opts.intervalMs ?? 3_000
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000)
    const terminal = new Set(['CONFIRMED', 'FAILED', 'DENIED'])

    while (Date.now() < deadline) {
      const tx = await this.getTransaction(txId)
      if (terminal.has(tx.status)) return tx
      await _sleep(interval)
    }
    throw new Error(`waitForTransaction: timed out waiting for tx ${txId}`)
  }

  /**
   * Get current wallet balances for this agent.
   */
  async getBalances(): Promise<BalanceEntry[]> {
    const res = await this._fetch(`/api/wallets/balance?agentId=${this.agentId}`)
    if (!res.ok) return []
    const data = await res.json() as { balances?: BalanceEntry[] }
    return data.balances ?? []
  }

  /**
   * Get balance for a specific chain + currency.
   * Returns null if the wallet/currency is not found.
   */
  async getBalance(chain: string, currency: string): Promise<BalanceEntry | null> {
    const balances = await this.getBalances()
    return balances.find(
      (b) => b.currency.toUpperCase() === currency.toUpperCase(),
    ) ?? null
  }

  /**
   * Get wallet assignments for this agent (chains + currencies + addresses).
   */
  async getWallets(): Promise<WalletInfo[]> {
    const policy = await this.getPolicy()
    return policy.wallets
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async _fetch(
    path: string,
    opts: RequestInit & { retryable?: boolean } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...(opts.headers as Record<string, string> | undefined),
    }

    const { retryable: _retryable, ...fetchOpts } = opts

    if (this.debug) {
      console.log(`[AgentPays] ${opts.method ?? 'GET'} ${url}`, opts.body ? JSON.parse(String(opts.body)) : '')
    }

    let lastError: unknown
    const maxAttempts = 1 + this.retries

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const res = await fetch(url, { ...fetchOpts, headers, signal: controller.signal })

        if (this.debug) {
          console.log(`[AgentPays] ${res.status} (attempt ${attempt + 1})`)
        }

        // Retry on 5xx or 429 with exponential backoff
        const shouldRetry = (res.status === 429 || res.status >= 500) && attempt < maxAttempts - 1
        if (shouldRetry) {
          await _sleep(this.retryDelayMs * Math.pow(2, attempt))
          continue
        }

        return res
      } catch (err) {
        lastError = err
        if (err instanceof Error && err.name === 'AbortError') {
          return _makeErrorResponse(408, 'TIMEOUT', 'Request timed out')
        }
        if (attempt < maxAttempts - 1) {
          await _sleep(this.retryDelayMs * Math.pow(2, attempt))
          continue
        }
      } finally {
        clearTimeout(timer)
      }
    }

    if (lastError) {
      return _makeErrorResponse(0, 'NETWORK_ERROR', String(lastError))
    }
    return _makeErrorResponse(0, 'NETWORK_ERROR', 'Unknown network error')
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function _makeErrorResponse(status: number, code: SpendErrorCode, error: string): Response {
  return new Response(JSON.stringify({ error, code }), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Operator SDK ─────────────────────────────────────────────────────────────

export interface OperatorOptions {
  baseUrl?: string
  /** Operator auth token (SIWE / session token) */
  authToken: string
  timeoutMs?: number
}

/**
 * Operator-side SDK for managing vaults, deposits, and wallet funding.
 * Uses operator auth (SIWE token), not agent API keys.
 */
export class AgentPaysOperator {
  private readonly baseUrl: string
  private readonly authToken: string
  private readonly timeoutMs: number

  constructor(opts: OperatorOptions) {
    if (!opts.authToken) throw new Error('AgentPaysOperator: authToken is required')
    this.baseUrl = (opts.baseUrl ?? 'https://agentpays.app').replace(/\/$/, '')
    this.authToken = opts.authToken
    this.timeoutMs = opts.timeoutMs ?? 30_000
  }

  private async _fetch(path: string, opts: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
          ...(opts.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /** List all vaults for this operator. */
  async getVaults(): Promise<VaultInfo[]> {
    const res = await this._fetch('/api/vaults')
    if (!res.ok) throw new Error(`getVaults failed: HTTP ${res.status}`)
    const data = await res.json() as { vaults: VaultInfo[] }
    return data.vaults
  }

  /** Get a single vault by ID. */
  async getVault(id: string): Promise<VaultInfo> {
    const res = await this._fetch(`/api/vaults/${id}`)
    if (!res.ok) throw new Error(`getVault failed: HTTP ${res.status}`)
    const data = await res.json() as { vault: VaultInfo }
    return data.vault
  }

  /**
   * Register a vault that was deployed client-side by the operator's browser wallet.
   * The operator deploys via factory.deployVault() on-chain, then saves the result here.
   */
  async registerVault(params: {
    chainId: number
    vaultAddress: string
    factoryAddress: string
    txHash: string
  }): Promise<VaultInfo> {
    const res = await this._fetch('/api/vaults', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(String(err.error ?? `registerVault failed: HTTP ${res.status}`))
    }
    const data = await res.json() as { vault: VaultInfo }
    return data.vault
  }

  /** Deposit funds into a vault. */
  async depositToVault(vaultId: string, walletId: string, currencySymbol: string, amount: number): Promise<{ txHash: string; depositId: string }> {
    const res = await this._fetch(`/api/vaults/${vaultId}/deposit`, {
      method: 'POST',
      body: JSON.stringify({ walletId, currencySymbol, amount }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(String(err.error ?? `depositToVault failed: HTTP ${res.status}`))
    }
    return res.json() as Promise<{ txHash: string; depositId: string }>
  }

  /** Get vault on-chain balances. */
  async getVaultBalances(vaultId: string): Promise<VaultBalance[]> {
    const res = await this._fetch(`/api/vaults/${vaultId}/balances`)
    if (!res.ok) throw new Error(`getVaultBalances failed: HTTP ${res.status}`)
    const data = await res.json() as { balances: VaultBalance[] }
    return data.balances
  }

  /** Pause or unpause a vault. */
  async pauseVault(vaultId: string, paused: boolean, walletId: string): Promise<VaultInfo> {
    const res = await this._fetch(`/api/vaults/${vaultId}`, {
      method: 'PATCH',
      body: JSON.stringify({ paused, isActive: !paused, walletId }),
    })
    if (!res.ok) throw new Error(`pauseVault failed: HTTP ${res.status}`)
    const data = await res.json() as { vault: VaultInfo }
    return data.vault
  }

  /** Sync wallet limits to the on-chain vault contract. */
  async syncVaultLimits(vaultId: string, walletId: string): Promise<{ txCount: number }> {
    const res = await this._fetch(`/api/vaults/${vaultId}/sync`, {
      method: 'POST',
      body: JSON.stringify({ walletId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(String(err.error ?? `syncVaultLimits failed: HTTP ${res.status}`))
    }
    return res.json() as Promise<{ txCount: number }>
  }

  /** Fund a wallet directly (legacy mode — not through vault). */
  async fundWallet(walletId: string, toAddress: string, currencySymbol: string, amount: number): Promise<{ txHash: string; explorerUrl: string }> {
    const res = await this._fetch(`/api/wallets/${walletId}/fund`, {
      method: 'POST',
      body: JSON.stringify({ toAddress, amount, currencySymbol }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(String(err.error ?? `fundWallet failed: HTTP ${res.status}`))
    }
    return res.json() as Promise<{ txHash: string; explorerUrl: string }>
  }
}

// ─── Convenience factory ──────────────────────────────────────────────────────

export function createAgentPays(opts: AgentPaysOptions): AgentPays {
  return new AgentPays(opts)
}

export function createAgentPaysOperator(opts: OperatorOptions): AgentPaysOperator {
  return new AgentPaysOperator(opts)
}

export default AgentPays
