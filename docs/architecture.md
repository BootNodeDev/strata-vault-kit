# Technical Architecture: Strata

**Product:** Strata, an RWA lifecycle protocol for attested-value assets:
request-based subscriptions and redemptions priced against on-chain guarded
attestations, built on OpenZeppelin's Stellar contracts. Distributed as a kit:
each operator deploys, configures and brands an independent white-label
instance. **Chain:** Stellar. Soroban smart contracts; classic assets consumed
through their Stellar Asset Contract (SAC) interface. **Deposit asset:** any
classic Stellar asset chosen at genesis (typically a USD stablecoin such as
USDC). **Maintainer:** BootNode (bootnode.dev).

Shares in this vault are a claim on an off-chain asset whose value is attested
on chain. No price exists at the moment you act, so entry and exit are requests:
what you put in goes into escrow, the next accepted attestation prices it, and
you claim the result.

---

## 1. Design principles

1. **Configured, not built.** Each operator deploys an independent instance: no
   factory, no shared state. A deployment is defined by its configuration and
   five authorities (native Stellar multisig accounts). Everything an operator
   brands or configures lives outside the trust boundary; everything inside it
   is the same code for every adopter.

2. **Built on OpenZeppelin, differentiated above it.** The share token is OZ's
   SEP-41 token with the SEP-57 RWA extensions (freeze, forced transfer,
   recovery); access control, pausable and upgradeable come from OZ crates.
   Dependencies are pinned to exact versions and audit inheritance is evaluated
   component by component; what Strata adds stays within its own audit scope.
   What OZ does not cover is the layer Strata adds: the attested valuation
   oracle, request-based flows priced against attestations, split reserve
   accounting, and the operational surface.

3. **Request-based entry and exit.** The exact price of a share does not exist
   when an investor acts; it is attested afterwards. Entry and exit are
   requests: funds or shares go into escrow, the epoch holding them is priced
   against an attestation, and the investor claims the result. This is the
   ERC-7540 pattern with two differences: cancellation is a single step, and the
   price comes from the attestation valid at pricing, not from a manager.
   Cancellation is an escape hatch rather than a choice: it closes as soon as
   the epoch could be priced, so nobody declines a price after reading it.

4. **Attested NAV.** The reporter attests the share price itself, computed
   off-chain from the deployed value and the vault's public figures under a
   documented methodology. The contract validates, stores and exposes it. Every
   on-chain operation preserves that price by construction: pricing a deposit
   releases escrow into the reserve and mints shares in proportion, pricing a
   redemption burns shares and fixes the matching liability, and a custodian
   transfer moves value between pockets without changing the total.

5. **Payable claims always pay.** Neither the guardian pause, a delisting, nor a
   stale valuation can block the payment of an already-priced, funded cash
   claim. A pause can delay unpriced requests. Priced claims are never re-priced
   and never identity-gated. A delisted, non-frozen investor exits through the
   exit-only cash path. Outside this guarantee, disclosed as trust assumptions:
   a frozen investor, deposit-asset issuer controls, and reserve liquidity.

6. **Split accounting, with priced and payable as separate states.** The vault
   exposes committed (priced redemption liabilities), cancellable escrow
   (pending subscriptions the investor can still cancel) and free reserve.
   Escrowed subscriptions never leave the vault. Committed can exceed the liquid
   reserve; that gap is explicitly uncovered on-chain, outbound transfers are
   blocked while it exists, and every priced claim the reserve covers stays
   payable as treasury tops up. Being uncovered is not insolvency: solvency
   compares total attested assets against liabilities and is handled by attested
   losses and governance.

## 2. Component overview

Orange marks what only Strata provides; white is the existing ecosystem the kit
consumes or integrates.

```mermaid
flowchart TB
    subgraph FE["FRONTEND · WHITE-LABEL"]
        LP["Investor dApp<br/>request · claim ·<br/>cancel · position"]:::strata
        ADM["Admin panel<br/>allowlist · valuation ·<br/>pause · treasury"]:::strata
    end

    subgraph ON["ONCHAIN · SOROBAN"]
        subgraph OZ["OpenZeppelin base"]
            ST["SEP-41 + SEP-57<br/>share token"]
            AC["Access control · pausable<br/>· upgradeable"]
        end
        SAC["Deposit asset ·<br/>Stellar Asset Contract"]
        subgraph SM["Strata modules"]
            V["Vault · request lifecycle"]:::strata
            OR["Valuation oracle ·<br/>guardrails · NAV"]:::strata
            SA["Split accounting ·<br/>uncovered exposure"]:::strata
            RQ["Covered redemption claims<br/>· exit-only path"]:::strata
            MGR["Manager ·<br/>token authority"]:::strata
            IVC["Compliance module<br/>SEP-57 identity + rules"]
        end
        AUTH["Role framework<br/>5 multisig authorities"]
    end

    subgraph OFF["OFF-CHAIN · OPERATOR"]
        TR["Treasury ops"]
        VS["Valuation source<br/>attestation data"]
        KYC["KYC process"]
    end

    subgraph RW["REAL-WORLD STRUCTURE"]
        CU["Legal wrapper · custody ·<br/>the asset"]
    end

    LP -->|"requests · claims"| V
    ADM -->|"admin operations"| AUTH
    OR ---|"attested value + proof ref ↑"| VS
    IVC ---|"verified addresses ↑"| KYC
    SAC ---|"reserve in / out"| TR
    TR -->|"transfer_to_custodian"| CU
    VS ---|"valuation data ↑"| CU

    classDef strata fill:#FFE0B2,stroke:#E65100,stroke-width:2px
```

Authority and contract wiring:

```mermaid
flowchart LR
    subgraph Investor
        W[Wallet<br/>Freighter / Wallets Kit]
        LP[Investor dApp<br/>backend-free]
    end

    subgraph Operator["Operator (off-chain)"]
        KYC[KYC process<br/>operator's own stack]
        VAL[Valuation source<br/>fund accounting]
        CUST[Custodian<br/>real-world structure]
    end

    subgraph Authorities["Authorities (native Stellar multisigs)"]
        GOV[governance]
        CMP[compliance]
        ATT[attestation]
        TRE[treasury]
        GRD[guardian]
    end

    subgraph Soroban["Soroban contracts (the kit)"]
        V[Vault<br/>requests, pricing,<br/>reserve accounting]
        ST[Share token<br/>OZ SEP-41 + SEP-57 ext]
        MGR[Manager<br/>token authority passthrough]
        CM[Compliance module<br/>SEP-57 identity + rules,<br/>allowlist]
    end

    OPS[Admin panel<br/>propose / review / sign / execute]

    W --> LP --> V
    KYC --> CMP
    VAL --> ATT
    GOV & CMP & ATT & TRE & GRD --> OPS --> V
    OPS --> MGR --> ST
    CMP -->|writes via Manager| CM
    ST -.->|identity + transfer rules| CM
    TRE -.->|free reserve only,<br/>nothing uncovered| CUST
    V ---|SAC interface| USDC[Deposit asset]
```

Both interfaces are backend-free: they read contract state and build
transactions that the authority multisigs sign. The chain never sees KYC data or
valuation methodology, only their outputs: an allowlisted address, an attested
number with a proof reference.

## 3. Components and authorities

| Component             | Role                                                                                                                                                                                                      | Controls                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vault**             | Request lifecycle, pricing, split reserve accounting, custodian transfers, upgrade control                                                                                                                | One authority per privileged entrypoint; upgrades behind a governance timelock with an exit window                                                                            |
| **Share token**       | OZ SEP-41 + SEP-57 RWA extensions: freeze, forced transfer, recovery, identity and compliance checks on every transfer, independent transfer pause                                                        | Token manager authority held exclusively by the Manager contract, never a human key                                                                                           |
| **Manager**           | Token manager passthrough: every privileged token operation goes through it and is checked against roles                                                                                                  | Role-gated                                                                                                                                                                    |
| **Compliance module** | Implements the SEP-57 identity and rules interfaces the share token consults, with the allowlist as its only rule                                                                                         | Written only by the compliance authority via the Manager; replaceable by OZ's identity verifier and compliance contracts (with RWA Wizard modules) without touching the token |
| **Five authorities**  | governance (parameters, roles, timelocked upgrades), compliance (allowlist, token interventions), attestation (valuation only), treasury (reserve movements only), guardian (pause; never payable claims) | Native Stellar multisig accounts; treasury and guardian distinct, compliance distinct from governance and treasury                                                            |
| **Custodian**         | Off-chain party holding the real-world structure; a genesis-configured slot rotatable only by governance                                                                                                  | Not an on-chain authority                                                                                                                                                     |

Each authority's threshold is sized to the quorum that authority requires.
Signing of privileged operations through a coordinator is verified end to end,
not assumed.

## 4. Request lifecycle

Every position change is a request with three states: **pending, priced,
claimed**. Requests join the open epoch. Sealing an epoch closes it to new
requests and opens the next; pricing it reads the oracle and fixes one share
price for every request it holds. Pricing is permissionless and refuses a feed
that is not valid, so a sealed epoch waits rather than settling at a stale
price, and no investor can choose their price.

Sealing is gated on the manager role today. It is meant to become permissionless
once a minimum epoch duration bounds it; until then, whoever seals chooses the
batch boundary, though not the price it receives.

### 4.1 Subscription

- Request: verifies the receiver is allowlisted, moves the deposit asset into
  escrow. At most one active request per controller.
- Pricing: the escrow leaves the cancellable bucket, the share quantity is set
  at the epoch's price, and the shares are minted and held for the investor.
- Cancellation: atomic, and returns the escrowed asset in full. Open while the
  epoch is, since no price applies to it yet. Once sealed it is refused while
  the feed could price the epoch, because the price is then already readable and
  cancelling would be declining it. A sealed epoch the feed cannot price is
  still cancellable, which is what gives a deposit a way out of an epoch that is
  stuck.
- Share claim: re-verifies the receiver and delivers the shares. If verification
  fails, the position remains shares and exits through the redemption lifecycle
  at the then-current price. No nominal refund exists after pricing.

### 4.2 Redemption

- Request: moves shares into escrow, no admission limit.
- Pricing: the escrowed shares are burned and a fixed cash liability enters
  committed at the epoch's price. Priced claims are never re-priced.
- Coverage: a priced claim is payable when the liquid reserve covers that
  claim's own amount, in any order. An earlier unpaid claim never blocks a later
  one that is already covered. The gap between committed and liquid reserve is
  the uncovered amount treasury must top up.
- Cash claim: pays the fixed amount; it does not depend on identity. A delisted,
  non-frozen investor uses the exit-only cash path and cannot cancel back to
  shares.

```mermaid
sequenceDiagram
    participant I as Investor (allowlisted)
    participant V as Vault
    participant O as Attestation authority
    I->>V: request_deposit(amount), asset to escrow
    Note over V: pending, cancellable
    O->>V: attestation
    Note over V: priced: shares minted and held,<br/>cancellation closed
    I->>V: claim, re-checks allowlist
    V-->>I: shares delivered
```

```mermaid
sequenceDiagram
    participant I as Investor
    participant V as Vault
    participant O as Attestation authority
    participant T as Treasury authority
    I->>V: request_redeem(shares), shares to escrow
    O->>V: attestation
    Note over V: priced: shares burned,<br/>cash liability fixed
    alt liquid reserve covers the claim
        I->>V: claim
        V-->>I: deposit asset paid
    else reserve short
        Note over V: uncovered amount visible on-chain
        T->>V: return_from_custodian(funds)
        I->>V: claim
        V-->>I: deposit asset paid
    end
```

## 5. Valuation and accounting

The NAV is a permissioned attestation of the share price, published with a proof
reference. The reporter computes it off-chain under a published methodology. The
contract checks bounds, cooldown and the deviation cap, then stores the price
and exposes it with the liquidity figures it owns:

```text
liquid_reserve = reserve - cancellable_deposit_escrow
free_reserve   = max(liquid_reserve - committed, 0)
uncovered      = max(committed - liquid_reserve, 0)
```

**Attestation guardrails:** the reporter is a multisig, never a single key. Each
attestation carries the share price and a proof reference; attestations are
ordered by their acceptance time on the ledger. The price must stay within
configured bounds, a minimum cooldown bounds frequency, and the deviation cap is
directional: the upward bound is mandatory and non-zero, the downward bound is
optional, and leaving it unset lets a loss of any size land in one attestation.

**Freshness and pause:** each attestation opens a validity window; when it
lapses the feed is stale and new requests stop being priced. Guardian or
governance can pause the vault: new requests, pricing and custodian transfers
stop; payable claims, pending cancellations and refunds continue; attestations
that pass the guardrails are still accepted, so recovery never deadlocks. Only
governance lifts the pause, and only while the latest attestation is fresh.
Paused and stale are independent: freshness lapses on its own, the pause is a
decision.

## 6. Compliance

- The share token follows the SEP-57 topology: it consults identity for every
  receiver and rules for every transfer. The kit ships one compliance module for
  both, with the allowlist as its only rule; an operator needing richer rules
  replaces it with OZ's contracts without touching the token.
- KYC happens wherever the operator runs it; the chain sees only its output. The
  compliance authority writes allowlist entries via the Manager.
- Token interventions (freeze, unfreeze, forced transfer, recovery) are
  compliance operations via the Manager, available even while the vault is
  paused.

## 7. Treasury and custodian

- The custodian is a genesis-configured slot; only governance can rotate it.
  Transfers to the custodian move free reserve only, only to that address, and
  only while nothing is uncovered.
- Transfers from the custodian are always open and credit only assets actually
  received.
- The exposed figures (share price, liquid reserve, committed, uncovered) make
  reserve coverage legible to investors and integrators.
- Closing a vault needs no dedicated mechanism: governance pauses the vault, the
  attester publishes the final value, treasury returns the funds, and every
  position exits through the normal redemption path.

## 8. Reference interfaces

Both interfaces are part of the kit: they are how investors and operators use
the protocol without writing code. Both are backend-free and read only the
public contract surface; each deployment brands and hosts its own.

### Investor dApp

The investor's five actions and nothing else: deposit request, share claim,
redeem request, cash claim, cancellation of a pending request. Nothing is valued
at request creation; the only reference shown is the latest attested NAV,
labelled and timestamped. Three states per side, none skipped: pending, priced,
claimed. Waiting is stated, never counted down. A priced cash claim shows
whether the reserve covers it and the current uncovered amount; a delisted
investor sees the exit-only path.

### Admin panel

Operates an existing vault; deploys nothing. Every privileged entrypoint belongs
to exactly one authority, so the panel splits into five surfaces:

| Surface       | Authority                             | Cadence             | Operations                                                                  |
| ------------- | ------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| Cycle         | attestation, treasury; anyone settles | Continuous          | Attestations, funding, transfers to and from the custodian, settlement      |
| Compliance    | compliance                            | Continuous          | Allowlist, freeze/unfreeze, forced transfer, recovery via Manager           |
| Emergency     | guardian                              | Rare and urgent     | Vault pause, share-token pause                                              |
| Configuration | governance                            | Rare and deliberate | Custodian slot, compliance module, parameters (bounds, freshness, timelock) |
| Governance    | governance                            | Very rare           | Roles, admin handover, upgrade                                              |

Every operation is shown in domain terms, with its conditions and resulting
state, before a signature is requested; read-only by default. Signing runs
through an existing self-hostable coordinator. Configuration is derived from the
public surface given the vault address.

## 9. Trust boundaries & failure modes

| Boundary               | Risk                                           | Mitigation                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Attestation authority  | Wrong or compromised reports misprice requests | Multisig reporter; the asymmetric deviation cap bounds any single report and the cooldown bounds frequency; a sustained sequence of biased reports within the cap remains possible, is bounded in speed, and is the monitoring plan's primary alert, with the guardian pause as the reactive control. Residual risk: value transfer between entry and exit cohorts |
| Governance keys        | Malicious upgrade                              | Timelock with an investor exit window; the guardian pause freezes the timelock clock so the window cannot be waited out while entries are closed                                                                                                                                                                                                                   |
| Treasury keys          | Reserve drained                                | Only free reserve is movable, only to the genesis-configured custodian, verified on-chain; outbound transfers are blocked while anything is uncovered, and escrowed subscriptions never leave the vault                                                                                                                                                            |
| Guardian keys          | Griefing via pause                             | Guardian can only pause new requests, pricing and custodian transfers; it can never block payable claims or move funds; governance reverts and rotates the role                                                                                                                                                                                                    |
| Compliance keys        | Wrongful delisting or freeze                   | Delisted investors keep the exit-only cash path; freezes require the Manager path and are auditable per operation                                                                                                                                                                                                                                                  |
| Compliance module      | Faulty module blocks transfers                 | Fail-closed semantics; replaceable by governance without touching the token                                                                                                                                                                                                                                                                                        |
| Deposit asset issuer   | Freeze or clawback of the vault's reserve      | Not mitigated by the kit; declared risk of the chosen asset, verified and reported at genesis (auth flags)                                                                                                                                                                                                                                                         |
| Custodian / real world | Underlying loss or delay                       | Reflected through attested NAV (downward updates uncapped); the kit constrains what reaches the chain, it does not verify the world                                                                                                                                                                                                                                |

Disclosed trust assumptions: the accuracy of the operator's KYC process, the
quality of the data behind each attestation, and the operator's key ceremony.

## 10. Deployment

Deployment is scripted and ends with no human key holding governance. It is
complete only when the final state is verified on-chain: every authority is the
intended multisig, no bootstrap key retains any role, the configuration matches
the request, and the deposit asset's auth flags are checked and reported.

## 11. Relationship to existing Stellar tooling

Where a cell says "Not provided", it means: not provided by SEP-41, SEP-56,
SEP-57, OpenZeppelin Stellar Contracts, or the Soroban vault implementations
evaluated (Templar, Untangled OctoVault, DeFindex).

| Component                                                                | Already exists                                                             | Strata                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEP-41 token + SEP-57 RWA extensions (freeze, forced transfer, recovery) | OpenZeppelin stellar-tokens; the RWA Wizard scaffolds the regulated token  | Consumed and extended; the kit's compliance module implements the SEP-57 interfaces the token expects                                                                                  |
| Synchronous tokenized vault                                              | SEP-56 / OZ Token Vault                                                    | Not a base for Strata: SEP-56 assumes the price exists at call time, so its interface cannot express a request lifecycle. Only OZ conversion and rounding math reused, as library code |
| Access control, pausable, upgradeable, timelock                          | OZ crates                                                                  | Consumed; pinned by exact version, audit coverage and gaps documented per component                                                                                                    |
| Multisig and signing coordination                                        | Native Stellar + existing coordinators, OZ Role Manager                    | Integrated                                                                                                                                                                             |
| Request lifecycle priced against attestations                            | Not provided (ERC-7540 on EVM, where OpenZeppelin ships an implementation) | Core of the kit                                                                                                                                                                        |
| Guarded valuation oracle with freshness and pause                        | Not provided                                                               | Core of the kit                                                                                                                                                                        |
| Split reserve accounting with explicit uncovered exposure                | Not provided                                                               | Core of the kit                                                                                                                                                                        |
| Covered redemption claims, exit-only path                                | Not provided                                                               | Core of the kit                                                                                                                                                                        |
| Reusable RWA configuration, verified genesis, white-label frontends      | Not provided                                                               | Core of the kit                                                                                                                                                                        |

## 12. Delivery phases

| Phase                                                   | Deliverables                                                                                                                                                                                                                   | Evidence of completion                                                                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1: Attested valuation and request pricing**           | Valuation oracle with guardrails, freshness and pause; request lifecycle with escrow, cancellation and pricing-time mint and burn; public kit spec                                                                             | Accounting property tests green in CI (price preserved by deposits, redemptions and custodian transfers; cancellation; rounding); multisig signing of privileged operations verified end to end through the coordinator |
| **2: Split accounting and redemption**                  | Uncovered exposure; covered redemption claims; exit-only cash path; SEP-57 integration (compliance module, delisted-investor path); threat model and monitoring plan                                                           | Settlement e2e test at 1, 10, 100 and 1,000 pending requests; SEP-57 path demonstrated end to end on testnet                                                                                                            |
| **3: Reference interfaces, audit remediation, mainnet** | Investor dApp and Admin panel (five surfaces, one per authority), backend-free; reproducible deployment; audit remediation (all critical and high findings fixed and verified, public changelog); mainnet reference deployment | Audit inheritance matrix published (component, version, audit report, Strata delta, resulting scope); external developer deploys a configured instance from docs alone; reference instance live on mainnet              |

The funded core is the valuation, pricing and accounting layer. The Investor
dApp and the Admin panel are how that core is used by investors and operators;
without the Admin panel the five authorities are not operable by a
non-developer, and the kit stops being a kit.
