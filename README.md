# Atlas Treasury OS (Beta Release)

An open-source, off-chain treasury automation framework for Solana.

> **Lineage:** Atlas Treasury OS is a fork of [keystoneOS](https://github.com/key-stone-dev/keystoneOS) (MIT). The original license and copyright notice are preserved in [LICENSE](LICENSE).

Atlas Treasury OS provides a deterministic, auditable treasury agent that operates within predefined economic rules while incorporating AI-guided reasoning and rationalisation.

The system combines rule-based execution with LLM-assisted decision guidance to produce transparent, verifiable treasury actions.

---

## What this is

Atlas Treasury OS is an off-chain treasury agent that can:

- Sweep SOL → USDC  
- Enforce minimum / maximum SOL sweep clamps  
- Apply time-based and value-based cadence logic  
- Apply spike cadence modifiers  
- Mint / burn a pegged token  
- Record every action via signed, verifiable receipts  
- Generate human-readable summaries  

---

## Important truths

- This is not a smart contract.  
- All behavior is implemented off-chain.  
- Funds are managed by the keypairs you provide.  
- The AI cannot sign transactions or move funds outside predefined constraints.  
- The AI may propose values and resolved action paths, but all outputs are enforced deterministically.  
- This repository provides infrastructure, not a trading or treasury strategy.

If you require immutable behavior, this system must be deployed as an on-chain program.

---

## Architecture note

This architecture mirrors early agent systems (ELIZA-style rule mediation), where:

- An AI component assists with interpretation, narration, and bounded proposal  
- Final execution remains deterministic, rule-enforced, and auditable  
- No autonomous control over funds exists outside predefined constraints  

This design intentionally prioritizes safety, transparency, and reproducibility.

---

## Features

- 24-hour launch safety cadence to reduce early-stage risk of malfunction  
- Time-based and value-based cadence (using SOL → USD pricing)  
- Spike detection with accelerated cadence  
- Minimum / maximum sweep clamps  
- SOL → USDC swaps via Jupiter  
- Mint / burn peg logic  
- Retry + backoff handling for swaps and transfers  
- Transparent protocol fee (client-side) with optional donation routing  
- Append-only JSON receipts for full auditability  
- LLM-based reporting for human-readable summaries, rationalisations, and explanations  
- Social / webhook integrations for public, real-time treasury transparency  

---

## Quickstart

```bash
npm install
cp config.example.json config.json
cp .env.example .env
npm run single
```

---

## Framework breakdown

A detailed, code-level breakdown of Atlas Treasury OS — including cadence logic, sweep maths, peg enforcement, AI guardrails, and scalability — is available here:

→ [Framework breakdown](https://github.com/AtlasTreasuryOS/atlas/blob/main/framework-breakdown.md)

