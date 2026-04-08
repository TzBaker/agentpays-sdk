# AgentPays SDK

Official JavaScript/TypeScript SDK for [AgentPays](https://agentpays.com) — crypto spending limits for AI agents.

Zero dependencies. Works in Node.js 18+, Deno, and Bun.

## Install

```bash
npm install agentpays-sdk
```

## Quick Start

```typescript
import { AgentPays } from "agentpays-sdk";

const pay = new AgentPays({
  agentId: "your-agent-id",
  apiKey: "apk_live_...",
  baseUrl: "https://agentpays.app",
});

// Check if you can spend (dry-run, no money moved)
const check = await pay.canSpend({
  amount: 5,
  currency: "USDC",
  chain: "eth-sepolia",
  action: "SEND",
});
console.log(check.approved); // true
console.log(check.remainingBudget); // 10.0

// Send payment
const result = await pay.spend({
  amount: 1,
  currency: "USDC",
  chain: "eth-sepolia",
  action: "SEND",
  memo: "Payment for API call",
  metadata: { toAddress: "0x123..." },
});
console.log(result.txHash); // 0xabc...
console.log(result.remainingBudget); // 9.0
```

## Initialize from Environment Variables

```typescript
// Reads AGENTPAYS_AGENT_ID, AGENTPAYS_API_KEY, AGENTPAYS_BASE_URL
const pay = AgentPays.fromEnv();
```

## API Reference

### Agent Methods

| Method | Description |
|--------|-------------|
| `spend(params)` | Send a payment on-chain. Returns tx hash on success. |
| `canSpend(params)` | Dry-run check — no money moved, no budget deducted. |
| `getStatus()` | Agent status: ACTIVE, PAUSED, REVOKED, LIMIT_HIT |
| `getPolicy()` | Spending limits, allowed chains, currencies, actions |
| `getBalances()` | All wallet balances across chains |
| `getBalance(chain, currency)` | Single balance lookup |
| `getWallets()` | List assigned wallets |
| `getTransaction(txId)` | Look up a specific transaction |
| `waitForTransaction(txId, opts?)` | Poll until CONFIRMED or FAILED |

### Vault Methods (Operator)

| Method | Description |
|--------|-------------|
| `getVaults()` | List operator's vaults |
| `getVault(vaultId)` | Get vault details |
| `registerVault(params)` | Deploy/register a vault |
| `depositToVault(vaultId, walletId, currency, amount)` | Deposit to vault |
| `getVaultBalances(vaultId)` | Vault token balances |
| `pauseVault(vaultId, paused, walletId)` | Pause/unpause vault |
| `syncVaultLimits(vaultId, walletId)` | Sync on-chain limits |
| `fundWallet(walletId, toAddress, currency, amount)` | Fund wallet (legacy) |

### Spend Parameters

```typescript
{
  amount: number;        // Amount in human units (1.5 = 1.5 USDC)
  currency: string;      // Token symbol: "USDC", "EURC", "ETH"
  chain: string;         // Chain: "eth-sepolia", "base-sep", "ethereum", "base"
  action: string;        // "SEND", "PAY_API", "SWAP", "MINT", "DEPOSIT"
  memo?: string;         // Optional description
  metadata?: object;     // Optional metadata (e.g., { toAddress: "0x..." })
  idempotencyKey?: string; // Prevent duplicate payments on retry
}
```

### Spend Result

```typescript
{
  approved: boolean;
  txHash?: string;           // On-chain transaction hash
  transactionId?: string;    // AgentPays internal ID
  remainingBudget?: number;  // Budget left after spend
  reason?: string;           // Denial reason (if not approved)
  error?: {
    code: string;
    message: string;
  };
}
```

## Error Handling

```typescript
const result = await pay.spend({ ... });

if (!result.approved) {
  switch (result.error?.code) {
    case "LIMIT_REACHED":
      console.log("Daily spending limit exceeded");
      break;
    case "AGENT_PAUSED":
      console.log("Agent is paused by operator");
      break;
    case "CURRENCY_NOT_ALLOWED":
      console.log("This currency is not in the agent's policy");
      break;
    case "EXECUTION_FAILED":
      console.log("On-chain transaction failed");
      break;
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTPAYS_AGENT_ID` | ✅ | Your AgentPays agent ID |
| `AGENTPAYS_API_KEY` | ✅ | Your AgentPays API key |
| `AGENTPAYS_BASE_URL` | ❌ | Server URL (default: `https://agentpays.app`) |

Legacy names also supported: `AGENTPAY_AGENT_ID`, `AGENTPAY_KEY`, `AGENTPAY_URL`.

## How It Works

```
Your AI Agent → AgentPays SDK → AgentPays Server → Policy Engine → Blockchain
                                                        ↓
                                              ✅ Within limits → execute
                                              ❌ Over budget → deny
```

The SDK never handles wallet keys. All signing happens server-side with encrypted keys. The agent only needs an API key with scoped permissions.

## License

MIT
