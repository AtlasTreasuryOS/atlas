# Atlas Treasury OS — Framework Breakdown

A code-level explanation of cadence, sweep maths, peg enforcement, AI guardrails, and scalability.

## 24-Hour Launch Safety Cadence (Why it exists)

The first 24 hours run inside a fixed safety window to reduce early-stage failure risk (RPC instability, bad config, low-liquidity edge cases, or initial wallet setup mistakes). During this window the cadence is forced to a conservative interval.

```js
if (uptimeHours < launch.safetyHours) {
  const mins = clamp(launch.intervalMin, cadence.minIntervalMin, cadence.maxIntervalMin);
  return { delayMs: mins * 60_000, spike: false, baselineMin: mins };
}
```

## Timing Sequence (What happens each tick)

The engine runs in a simple loop: tick → wait → tick. In production this is a daemon-like runner. It isn’t a strict hourly cadence — the system checks roughly hourly by default, but actual actions are gated, delayed, or accelerated based on current conditions.

```js
while (true) {
  await tick({ cfg, personalityPath: null, runtime });
  const intervalMs = (cfg.launch.intervalMin || 1) * 60 * 1000;
  await new Promise(r => setTimeout(r, intervalMs));
}
```

Inside a tick, the system:
1. reads balances (dev SOL, collector SOL, treasury USDC, stable supply)
2. chooses a sweep % (policy or AI proposal)
3. clamps sweep amount into safe bounds
4. swaps SOL→USDC (Jupiter) then routes USDC to treasury (and optional fee/donation)
5. checks peg drift and optionally mint/burns
6. writes a receipt and summary

## Cadence Logic (How timing is reactive)

Cadence responds to three real signals.

### 1. Launch age

Enforces a conservative timing window immediately after deployment and prevents acceleration during the system’s most fragile phase.

```js
const uptimeHours = (nowMs - launchTsMs) / (60 * 60 * 1000);

if (uptimeHours < launch.safetyHours) {
  const mins = clamp(launch.intervalMin, cadence.minIntervalMin, cadence.maxIntervalMin);
  return { delayMs: mins * 60_000, spike: false, baselineMin: mins };
}
```

### 2. Dev wallet USD value

Higher value → shorter baseline interval.  
Lower value → longer baseline interval.  
Uses a log-scaled smoothstep (not linear).

```js
const x = Math.log10(Math.max(valueUSD, 0.01));
const pivotX = Math.log10(Math.max(pivotUsd, 0.01));
const t = clamp(x / pivotX, 0, 1);
const s = smoothstep(t);

return minIntervalMin + s * (maxIntervalMin - minIntervalMin);
```

### 3. Activity spikes

Sudden absolute or percentage increases temporarily shorten cadence to react faster.

```js
const deltaUSD = devValueUSD - lastDevValueUSD;
const deltaPct = deltaUSD / lastDevValueUSD;

if (deltaUSD >= cadence.spikeUsd || deltaPct >= cadence.spikePct) {
  intervalMin = intervalMin * cadence.spikeIntervalMult;
}
```

This is why cadence is conditional and reactive rather than speculative.

## Sweep Maths (Percentage → SOL → Hard clamps)

The sweep decision is percentage-based, but execution is amount-based with hard caps. These caps prevent dust-level movements on the low end and liquidity shocks on the high end, keeping treasury growth smooth, predictable, and execution-safe.

### 1. Policy selection

- **Normal mode:** random between `minPct` and `maxPct`  
- **Spike mode:** `spikePct` if delta SOL crosses spike threshold

```js
function chooseSweepPct({ deltaCollectorSOL, cfg }) {
  const p = cfg.policy;
  if (deltaCollectorSOL >= p.spikeSol) return p.spikePct;
  return p.minPct + Math.random() * (p.maxPct - p.minPct);
}
```

### 2. Amount clamping

1. cannot sweep below `collectorSolBuffer`
2. cannot go below `minSolChunk`
3. cannot exceed `maxSolChunk`

```js
let sweep = collectorSOL * pct;
sweep = Math.min(sweep, Math.max(collectorSOL - lim.collectorSolBuffer, 0));
sweep = Math.max(sweep, lim.minSolChunk);
sweep = Math.min(sweep, lim.maxSolChunk);
```

## Starting Sweep (Why “0.08” config)

Chosen to minimise risk while still allowing the system to observe real conditions and signal intent.

1. 0.08% emerged from Atlas’s early operation as a conservative starting ratio.
2. It sits well below execution caps, ensuring early sweeps never pressure liquidity, cadence, or system stability.
3. This is especially important during the first 24 hours, when the system is most fragile and operating inside a fixed safety window.
4. At this level, the ratio expresses intent without determining impact.
5. Actual execution remains governed by hard SOL limits and the launch safety window.
6. As balances and activity grow, the same ratio naturally resolves into larger absolute sweeps without changing the rules.

Atlas serves as a live, real-world reference for how these parameters behave under actual conditions — not just theoretical assumptions.

## Scalability by Configuration (Why this replicates cleanly)

Scalability in Atlas comes from the fact that behavior is entirely configuration-driven. The execution path does not change between deployments — only the parameters do.

```js
await tick({ cfg, personalityPath: null, runtime });
```

All timing, sweep bounds, peg thresholds, wallet addresses, and AI permissions are read from configuration at runtime. There is no global state and no hard-coded assumptions tied to a single deployment.

```js
const p = cfg.policy;
const lim = cfg.limits;
const cadence = cfg.cadence;
```

Wallets are explicitly defined per instance, allowing multiple deployments to run the same logic in parallel without shared risk.

```js
const devPubkey = cfg.wallets.dev;
const collectorPubkey = cfg.wallets.collector;
const treasuryPubkey = cfg.wallets.treasury;
```

Because the same deterministic execution path is reused with different configuration inputs, new instances can be launched without modifying core logic. Scaling occurs by replicating the framework, not stretching it, so safety guarantees hold as adoption grows.

## Peg Section (Reserve vs Supply)

Peg enforcement is conditional. Drift is checked and only corrected if it exceeds a configured threshold and supply is non-zero.

```js
const drift = +(reserveNow - supplyNow).toFixed(6);

if (Math.abs(drift) >= cfg.mintBurn.minDrift && supplyNow > 0) {
  // mint if reserve > supply, burn if reserve < supply
}
```

Note: in the current configuration, `mintBurn.enabled` is set to false. Public descriptions of peg behavior should always reflect deployed configuration.

## AI Proposals (Bounded adaptation)

AI is intentionally prevented from executing actions to preserve determinism and safety. It can only make bounded proposals and monitor state.

```js
const proposed = await proposeSweepPct({ cfg, state: { ... } });

if (Number.isFinite(proposed)) {
  pct = policy.clamp(proposed, cfg.policy.minPct, cfg.policy.maxPct);
}
```

AI participation is explicitly gated by configuration.

```js
if (!cfg?.llm?.enabled) return null;
if (cfg.llm.mode !== 'rules_proposer') return null;
```

The AI layer operates under strict constraints by design:
1. Execution remains fully deterministic.
2. AI contributes only within bounded policy.
3. State is observed, not controlled.
4. Behavior is non-discretionary.
5. Interpretation is separated from execution in an ELIZA-style architecture.
