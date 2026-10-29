# Monitoring plan

What an operator watches on chain to run a Strata vault: each signal, where it
comes from, when it fires, how urgent it is, who is told and what they do. It
covers stale valuation, reserve coverage, privileged actions and storage that
expires.

This is a plan, not running alerts. Nothing in the kit watches the chain or
sends a message today; push alerts are planned after v1
([design doc §11](./strata-product-and-architecture.md#11-potential-future-features)).
Getter, event and entrypoint names are those of the contracts at commit
`641765d`. The testnet deployment in the [README](../README.md) may run older
code.

Every threshold below is a default. It depends on the deployment's parameters,
so set each one from the values in
[Parameters the thresholds read](#parameters-the-thresholds-read) before the
vault opens, and again whenever they change.

## How to read it

Each signal has an id: V for valuation, C for coverage, P for privileged
actions, T for storage lifetime. Under it:

- **Source:** a getter or an event, and the contract it comes from. A getter is
  a read-only call, simulated over RPC with no fee and no signature. An event
  is read with `getEvents`.
- **Threshold:** when the signal fires, by default.
- **Severity** and **told:** how fast someone acts, and who.
- **Response:** what they do, with a link to the runbook or the threat where one
  exists.

| Severity | Meaning |
| --- | --- |
| Critical | Act now, at any hour. Value can move, or pricing or exits have stopped. |
| Warning | Act within the working day. Something breaks later if nobody does. |
| Info | Record it, and review the record once a day. |

| Told | Who |
| --- | --- |
| On call | Whoever runs the watcher for the operator. Told of every Critical and Warning signal. |
| Governance, guardian, treasury, attester, compliance | The signers of that authority ([kit spec §3](./kit-spec.md#3-role--authority-matrix)). |
| Manager | Whoever runs the account that holds the vault's `manager` role and seals epochs. |
| Holders | A public notice on the operator's own channel. |

## Summary

| Id | Signal | Severity | Told, besides on call |
| --- | --- | --- | --- |
| V1 | Report close to expiry | Warning | Attester |
| V2 | Feed not valid | Critical | Attester, governance |
| V3 | Reports expire before the notice ends | Warning | Governance |
| V4 | A large step | Warning | Attester, governance |
| V5 | A run of reports one way | Critical | Guardian, governance, attester |
| V6 | The stored report is cleared | Critical | Governance, guardian |
| V7 | The first report after a clear | Critical over the threshold, else Info | Governance, guardian, attester |
| C1 | Priced exits the vault cannot pay | Warning; Critical when it lasts | Treasury; governance on Critical |
| C2 | Not enough cash for the next pricing | Warning | Treasury |
| C3 | The vault holds less than its pending escrow | Critical | Treasury, governance |
| C4 | The asset's issuer acts on the vault | Critical | Treasury, governance |
| C5 | A sealed epoch is not priced | Warning; Critical after 24 hours | Attester, manager |
| C6 | The open epoch runs long | Warning | Manager, governance |
| C7 | Redemptions waiting for a price | Info; Warning above 25% of supply | Treasury, governance |
| P1 | Vault paused or unpaused | Critical; Warning for an unpause | Governance, guardian |
| P2 | NAV paused or lifted | Critical; Warning for a lift | Governance, guardian, attester |
| P3 | Share-token transfers paused or unpaused | Warning | Governance, compliance |
| P4 | Role granted or revoked | Critical for a grant; Warning for a revoke | Governance, the authority concerned |
| P5 | Admin hand-over | Critical | Governance |
| P6 | Change proposed to the timelock | Critical or Warning, by kind | Every governance signer, guardian, holders |
| P7 | Change applied, cancelled or due | Warning | Governance |
| P8 | Settings that act at once | Warning | Governance |
| P9 | Wind-down | Critical when proposed or activated, else Info | Governance, treasury, holders |
| P10 | Capital sent to the custodian | Warning when unplanned, else Info | Treasury, governance |
| P11 | Compliance acts on a holder | Warning for a freeze; Critical for a legal transfer or recovery | Compliance, governance |
| P12 | The token's rules or verifier change | Critical | Governance, compliance |
| P13 | Wiring drift | Critical | Governance |
| T1 | Instance or code close to archiving | Warning; Critical under two days | On call only |
| T2 | Pending change close to archiving | Warning | On call only |

## Parameters the thresholds read

| Parameter | Where to read it | Signals |
| --- | --- | --- |
| `freshness_duration`, `cooldown_secs` | `config()` on the oracle | V1, V3, V5 |
| `max_up_bps`, `max_down_bps` | `config()` on the oracle | V4, V5, V7 |
| `min_answer`, `max_answer` | `config()` on the oracle | V2, V7 |
| The notice | `notice()` on the vault | V3, C5 |
| The upgrade delay | `upgrade_delay()` on the vault | P6, P7 |
| The wind-down delay | `wind_down_delay()` on the vault | P9 |
| How often the attester reports | The operator's schedule, off chain | V1, V5 |
| How long an epoch stays open | The operator's schedule, off chain | C6 |
| How soon the fund's terms pay a priced exit | The fund's terms, off chain | C1 |

Re-read the on-chain values whenever the oracle publishes `ConfigSet` or the
vault publishes `NoticeSet`, `WindDownDelaySet` or `ChangeApplied`.

## How events are read and kept

- **Retention.** An RPC server answers `getEvents` only for recent ledgers. The
  default window is 120,960 ledgers, about seven days, and each provider can
  set its own. `getHealth` returns `oldestLedger`, `latestLedger` and
  `ledgerRetentionWindow`. The public testnet RPC reported 120,960 on
  2026-10-28.
- **Poll inside the window.** By default the watcher polls once a minute. It
  keeps the `cursor` each response returns and starts the next request from it.
- **Keep history yourself.** Once a gap is longer than the window, its events
  are gone from RPC. Store each event as it is read, or read from an indexer
  that keeps full history. After any gap, run every getter check at once:
  getters show where things stand, so a missed event still shows in the state
  it left.
- **Names on chain.** Each event publishes its name in snake_case as its first
  topic: `NavAttested` arrives as `nav_attested`. Filter by contract id and that
  topic. [Events the plan reads](#events-the-plan-reads) lists each one.
- **A refused call publishes nothing.** A failed transaction rolls back its
  events, so a refusal such as `FeedNotValid` or `ClaimNotCovered` leaves no
  event. The plan watches the state that causes a refusal instead.
- **Getters.** Poll them every five minutes by default, and right after any
  event from the vault's contracts.

## Stale valuation

The oracle holds one report. It stays valid until its `expires_at`, which is at
most `freshness_duration` after the oracle accepted it, while it sits in the
band `[min_answer, max_answer]` and the NAV is not paused. The vault prices an
epoch only from a valid report accepted at or after the epoch was sealed.
Prices are in WAD: `10^18` is one asset base unit per share base unit.

### V1. Report close to expiry

- **Source:** `latest()` on the oracle, whose `expires_at` is in seconds.
  Compare it with the latest ledger's close time.
- **Threshold:** less than a quarter of `freshness_duration` left, with no newer
  `NavAttested`.
- **Severity:** Warning. **Told:** attester.
- **Response:** the attester posts a report (`attest`). If it cannot, prepare
  for V2.

### V2. Feed not valid

- **Source:** `state()` on the oracle answers `Stale`: no report, an expired
  one, or one outside the band. `is_stale()` gives the same answer but ignores
  the NAV pause. On the vault, `health().feed_valid` is false. A `Paused`
  answer is P2.
- **Threshold:** any time after the first report. Right after a deploy, `Stale`
  is normal until the first `attest`.
- **Severity:** Critical. **Told:** attester, governance.
- **Effect:** `fulfill_epoch` refuses with `FeedNotValid` (6044), so nothing is
  priced. Requests in sealed epochs can be cancelled again. Priced claims still
  pay. `request_deposit` also refuses with `FeedNotValid` while the feed is
  stale or the NAV is paused, so no new deposit waits on a stalled feed.
- **Response:** the attester posts a report. If the attester is gone, follow
  [When the Manager or the Attester Stops](./kit-spec.md#when-the-manager-or-the-attester-stops).
  If the report fell out of a band governance changed, see
  [O9](./THREAT_MODEL.md#o9-governance-changes-the-limits-or-the-feed).
  Threat: [O4](./THREAT_MODEL.md#o4-the-feed-goes-stale).

### V3. Reports expire before the notice ends

- **Source:** `health().freshness_covers_notice` on the vault is false:
  `freshness_duration` is shorter than `notice()`.
- **Threshold:** any time.
- **Severity:** Warning. **Told:** governance.
- **Response:** a sealed epoch's cancellation window can reopen on its own
  ([O6](./THREAT_MODEL.md#o6-declining-a-price-after-seeing-it)). Governance
  proposes a longer `freshness_duration` (a `Config` change) or a shorter
  notice (a `Notice` change); both wait for the timelock. The instant changes,
  a shorter freshness window or a longer notice, widen the gap.

### V4. A large step

- **Source:** `NavAttested` on the oracle, with `nav_per_share`. Compare it with
  the report before it, which the watcher keeps; read `latest()` once when the
  watcher starts. The step in basis points is `(new - old) * 10,000 / old`.
- **Threshold:** a step that uses 80% or more of its cap: `max_up_bps` for a
  rise, `max_down_bps` for a fall.
- **Severity:** Warning. **Told:** attester, governance.
- **Response:** check the report's evidence (`proof_hash`, `proof_uri`) against
  the valuation off chain. If the evidence does not back it, handle it as V5.

### V5. A run of reports one way

A compromised attester can walk the price in many steps, each inside its cap.

- **Source:** `NavAttested` on the oracle, as in V4.
- **Threshold:** any of these:
  - three reports in a row that move the same way, each using half its cap or
    more;
  - a total move over 24 hours larger than one full cap;
  - more reports in 24 hours than the attester's schedule, plus one.
- **Severity:** Critical. **Told:** guardian, governance, attester.
- **Response:** check each report's evidence. If it backs the moves, this is a
  real move larger than a cap
  ([O3](./THREAT_MODEL.md#o3-a-real-move-larger-than-a-cap)), and governance
  decides whether to pause and clear. If it does not, the guardian pauses the
  NAV (`pause_nav`) at once, and governance follows
  [Replacing a Compromised Attester](./kit-spec.md#replacing-a-compromised-attester),
  the order in
  [design doc §8.9](./strata-product-and-architecture.md#89-trust-boundaries--failure-modes).
  Threat: [O2](./THREAT_MODEL.md#o2-a-walk-of-reports).

### V6. The stored report is cleared

- **Source:** `LatestCleared` on the oracle. Only the oracle's admin calls
  `clear_latest`, and only while the NAV is paused.
- **Threshold:** every one.
- **Severity:** Critical. **Told:** governance, guardian.
- **Response:** confirm it is a step of a runbook governance started:
  [Replacing a Compromised Attester](./kit-spec.md#replacing-a-compromised-attester)
  or
  [Upgrading the Oracle from an Earlier Release](./kit-spec.md#upgrading-the-oracle-from-an-earlier-release)
  ([O11](./THREAT_MODEL.md#o11-an-oracle-upgraded-in-place-cannot-read-its-old-report)).
  If nobody planned it, treat governance's keys as compromised
  ([R2](./THREAT_MODEL.md#r2-governance-compromised-the-powers-that-act-at-once)):
  the guardian keeps the NAV paused, calling `pause_nav` again if it is lifted,
  while the governance signers replace their keys. Then watch V7. Threat:
  [O8](./THREAT_MODEL.md#o8-clearing-the-stored-report).

### V7. The first report after a clear

- **Source:** the first `NavAttested` after `LatestCleared`. No cap applies to
  it, only the band. Compare it with the last report before the clear, which
  the watcher keeps.
- **Threshold:** it moves further from that report than `max_up_bps` or
  `max_down_bps` would have allowed.
- **Severity:** Critical over the threshold; Info otherwise. **Told:**
  governance, guardian, attester.
- **Response:** check its evidence before anyone prices with it. Once an
  epoch's notice has run, anyone can call `fulfill_epoch`, and every epoch
  sealed before this report is priced from it. If the evidence does not back
  it, the guardian pauses the NAV and governance clears it again
  ([O8](./THREAT_MODEL.md#o8-clearing-the-stored-report)).

## Reserve coverage

The vault's figures, all in asset base units:

- `liquid_reserve()`: what the vault holds, less `cancellable_escrow()`, the
  deposits that can still be cancelled.
- `committed()`: owed to priced redemptions not yet claimed.
- `uncovered()`: `committed()` less `liquid_reserve()`, when that is positive.
- `free_reserve()`: what is left after escrow, `committed()` and
  `wind_down_owed()`. It is all treasury can send to the custodian.

### C1. Priced exits the vault cannot pay

- **Source:** `uncovered()` on the vault.
- **Threshold:** Warning above zero. Critical when it stays above zero longer
  than the fund's terms allow for paying a priced exit (default 72 hours), or
  keeps growing while no `Funded` arrives.
- **Told:** treasury; governance too on Critical.
- **Effect:** a claim the liquid reserve cannot cover fails with
  `ClaimNotCovered` (6037) and stays owed. Nothing goes to the custodian while
  anything is uncovered.
- **Response:** treasury brings capital back from the custodian and calls
  `fund`. Threat:
  [X1](./THREAT_MODEL.md#x1-the-reserve-cannot-pay-a-priced-exit).
- **In a wind-down:** `uncovered()` leaves out `wind_down_owed()`. Watch
  `liquid_reserve() - committed() - wind_down_owed()` instead; below zero is
  Critical ([X8](./THREAT_MODEL.md#x8-wind-down)).

### C2. Not enough cash for the next pricing

- **Source:** on the vault, the headroom `liquid_reserve() - committed()`,
  against what the sealed epochs would commit: for each epoch whose
  `get_epoch(id)` status is `Pending`,
  `total_shares_redeeming * nav_per_share / 10^18`, with `nav_per_share` from
  `latest()` on the oracle.
- **Threshold:** the headroom is smaller than that total.
- **Severity:** Warning. **Told:** treasury.
- **Response:** treasury brings capital back before the epochs are priced, so
  C1 does not fire.

### C3. The vault holds less than its pending escrow

- **Source:** `liquid_reserve()` on the vault is below zero. This happens only
  after cash leaves outside the vault's own calls, such as an issuer clawback
  (C4).
- **Threshold:** below zero.
- **Severity:** Critical. **Told:** treasury, governance.
- **Effect:** the escrow depositors can cancel is not all there. `uncovered()`
  counts the gap. `request_deposit` refuses with `EscrowNotCovered` (6076) while
  `liquid_reserve()` is below zero, so a new deposit never pays an earlier
  cancellation, and `cancel_deposit` refuses with `EscrowNotCovered` when the
  vault's balance cannot cover that deposit.
- **Response:** treasury calls `fund` with at least `-liquid_reserve()`, plus
  `committed()` to pay priced exits too. The refusals lift once the vault is
  funded. Threat:
  [X10](./THREAT_MODEL.md#x10-the-deposit-assets-issuer-freezes-or-claws-back-the-vaults-cash).

### C4. The asset's issuer acts on the vault

- **Source:** events of the deposit asset's contract that name the vault:
  `clawback`, and `set_authorized` with `false`, which freezes the vault's
  balance. If the event is missed, C3 or C1 still catch a clawback.
- **Threshold:** every one.
- **Severity:** Critical. **Told:** treasury, governance.
- **Response:** after a clawback, fund the gap as in C3. A freeze stops every
  cash exit until the issuer lifts it: the vault's checks still pass, and each
  transfer fails inside the asset. The kit has no control here
  ([X10](./THREAT_MODEL.md#x10-the-deposit-assets-issuer-freezes-or-claws-back-the-vaults-cash)).

### C5. A sealed epoch is not priced

- **Source:** epochs with an `EpochClosed` and no `EpochFulfilled` on the vault.
  For each, `get_epoch(id)` gives `priceable_at`; compare it with the ledger
  time.
- **Threshold:** Warning when `priceable_at` passed more than an hour ago.
  Critical after 24 hours.
- **Told:** attester, manager.
- **Response:** anyone can call `fulfill_epoch(id)`, and the operator runs a
  keeper that does. If it refuses: `FeedNotValid` is V2 or P2;
  `AttestationBeforeClose` means no report was accepted since the seal, so the
  attester posts one; `EnforcedPause` is P1.

### C6. The open epoch runs long

- **Source:** the ledger time against the last `EpochClosed`, or against
  `closed_at` from `get_epoch` for the epoch before `current_epoch()`.
- **Threshold:** one and a half times the epoch length the operator runs.
- **Severity:** Warning. **Told:** manager, governance.
- **Response:** the manager calls `close_epoch`. Once the open epoch has run
  the minimum epoch duration (`min_epoch_duration()`), anyone may call it
  instead. If the manager is gone and no minimum is set, follow
  [When the Manager or the Attester Stops](./kit-spec.md#when-the-manager-or-the-attester-stops).
  Threat:
  [R8](./THREAT_MODEL.md#r8-the-manager-stops-sealing-or-picks-the-moment).

### C7. Redemptions waiting for a price

- **Source:** on the vault, `total_shares_redeeming` from `get_epoch` for the
  open epoch and each `Pending` one, against `total_economic_supply()`.
- **Threshold:** Info above 10% of the supply; Warning above 25%.
- **Told:** treasury, governance.
- **Response:** a large exit is coming. Treasury plans the cash (C2).
  `committed()` and `pending_burn_shares()` show priced exits not yet claimed;
  holders claim when they like, so those figures alone need no action unless
  C1 fires.

## Privileged actions

Each privileged call on the vault, the share token, the oracle and the
compliance contract publishes an event. After each contract's setup, role
grants, upgrades, admin hand-overs and most settings first wait in the
timelock queue
([R1](./THREAT_MODEL.md#r1-governance-compromised-the-changes-that-wait)), so a
`ChangeProposed` comes at least the upgrade delay before the change lands.
[R2](./THREAT_MODEL.md#r2-governance-compromised-the-powers-that-act-at-once)
lists the powers that act at once.

### P1. Vault paused or unpaused

- **Source:** `Paused` and `Unpaused` on the vault; `paused()` on the vault.
- **Threshold:** every one.
- **Severity:** Critical for a pause; Warning for an unpause. **Told:**
  governance, guardian.
- **Effect:** while paused, the vault takes no deposit request, prices nothing
  and applies no queued change, and each queued change waits longer by the
  time paused. Claims, cancellations and redemption requests go on.
- **Response:** the guardian confirms it paused on purpose, and governance lifts
  the pause with `unpause` once the cause is fixed. A pause the guardian's
  signers did not agree to means its keys are compromised: governance revokes
  the guardian (`revoke_role`, instant). Threat:
  [R6](./THREAT_MODEL.md#r6-guardian-compromised).

### P2. NAV paused or lifted

- **Source:** `NavPausedSet` on the oracle, with `paused` true or false;
  `state()` answers `Paused`.
- **Threshold:** every one.
- **Severity:** Critical for a pause; Warning for a lift. **Told:** governance,
  guardian, attester.
- **Effect:** while paused, no report lands and nothing is priced, and sealed
  epochs reopen to cancellation. `request_deposit` refuses with `FeedNotValid`.
- **Response:** confirm a runbook is in progress (see V6). Only governance lifts
  the pause (`set_nav_paused(false)`). For a pause nobody planned, governance
  revokes the oracle's guardian (instant) and lifts the pause
  ([O7](./THREAT_MODEL.md#o7-the-nav-pause-used-to-stall-pricing)). For a lift
  nobody planned, treat governance's keys as compromised, and the guardian
  pauses again.

### P3. Share-token transfers paused or unpaused

- **Source:** `Paused` and `Unpaused` on the share token; `paused()` on the
  share token.
- **Threshold:** every one.
- **Severity:** Warning. **Told:** governance, compliance.
- **Effect:** stops `transfer` and `transfer_from` between holders only.
  Deposits, exits, escrow and claims go on.
- **Response:** only governance, the token's admin, can do this. If governance
  did not, treat its keys as compromised
  ([R2](./THREAT_MODEL.md#r2-governance-compromised-the-powers-that-act-at-once)).

### P4. Role granted or revoked

- **Source:** `RoleGranted` and `RoleRevoked` on the vault, the share token and
  the oracle, with the role and the account as topics. Role holders:
  `manager()`, `treasury()` and `guardian()` on the vault, and `has_role`,
  `get_role_member_count` and `get_role_member` on each contract.
- **Threshold:** every one.
- **Severity:** Critical for a grant; Warning for a revoke. **Told:**
  governance, and the authority whose role changed.
- **Response:** after setup, a grant lands only through a `GrantRole` change
  proposed at least the upgrade delay earlier (P6); check the account against
  that proposal. A second `manager` on the share token also turns
  `health().sole_token_manager` false (P13). Revoking the vault's treasury or
  guardian, the oracle's attester or guardian, or the token's compliance role
  is instant: confirm governance meant it. Threats:
  [R1](./THREAT_MODEL.md#r1-governance-compromised-the-changes-that-wait),
  [R5](./THREAT_MODEL.md#r5-one-account-in-several-seats).

### P5. Admin hand-over

- **Source:** `AdminTransferInitiated` and `AdminTransferCompleted` on the
  vault, the share token, the oracle and the compliance contract; `get_admin()`
  on each, and `governance()` on the vault.
- **Threshold:** every one.
- **Severity:** Critical. **Told:** governance.
- **Response:** after setup, the offer comes from an applied `Admin` change
  (P7). Confirm the new admin is the account governance chose.

### P6. Change proposed to the timelock

- **Source:** `ChangeProposed`, with the change and its `eta`, on the vault,
  the share token, the oracle and the compliance contract. The event's `eta`
  is the one `pending_changes()` reports at that moment. Every second the
  vault spends paused afterwards, a pause already running included, moves the
  real one later, so P7 reads `pending_changes()`. `pending_changes()` on each
  lists what waits.
- **Threshold:** every one.
- **Severity:** Critical for `Upgrade`, `Admin`, `GrantRole`, `RevokeRole`,
  the vault's `Oracle` and `Custodian`, the token's `Compliance` and
  `IdentityVerifier`, and every change on the compliance contract. Warning for
  the rest: `UpgradeDelay`, `Notice`, `WindDownDelay` and the oracle's
  `Config`.
- **Told:** every governance signer, the guardian, and holders, since the delay
  is their notice.
- **Response:** every governance signer checks it against what they agreed, and
  governance cancels one it did not agree to (`cancel_change`). If governance's
  quorum is compromised, a vault pause stops the timelock clock and blocks
  applying, but governance can lift it, so it only buys time
  ([R1](./THREAT_MODEL.md#r1-governance-compromised-the-changes-that-wait)).

### P7. Change applied, cancelled or due

- **Source:** `ChangeApplied` and `ChangeCancelled` on the four contracts; the
  `eta` of each entry in `pending_changes()`.
- **Threshold:** every applied or cancelled change, and a pending change within
  24 hours of its `eta`.
- **Severity:** Warning. **Told:** governance.
- **Response:** before an `eta`, confirm the change is still wanted. After an
  apply, re-read the [parameters](#parameters-the-thresholds-read); after a
  `Custodian` change, treasury confirms the new address.

### P8. Settings that act at once

- **Source:** `DepositCapUpdated`, `NoticeSet`, `WindDownDelaySet` and
  `CustodianSet` on the vault; `ConfigSet` on the oracle. After setup, the
  instant ones are the deposit cap either way, a longer notice or wind-down
  delay, and a shorter `freshness_duration`; the rest come from applied changes
  (P7).
- **Threshold:** every one.
- **Severity:** Warning. **Told:** governance.
- **Response:** confirm governance meant it, and re-read the parameters. A
  longer notice delays pricing of every epoch sealed after it, and can make V3
  fire.

### P9. Wind-down

- **Source:** `WindDownProposed`, with `active_at`, `WindDownProposalCancelled`,
  `WindDownActivated` and `WindDownRoundFinalized` on the vault; `wind_down()`
  on the vault.
- **Threshold:** every one.
- **Severity:** Critical when proposed or activated; Info otherwise. **Told:**
  governance, treasury, holders.
- **Effect:** while the wind-down is proposed, `request_deposit` refuses with
  `WindDownAlreadyProposed` (6048); once it is active, with `WindDownActive`
  (6046).
- **Response:** once `active_at` passes, anyone can activate it; until then
  governance can cancel it. Once active it cannot be undone, nothing is priced,
  and holders exit through rounds paid from the free reserve. Treasury brings
  capital back through `fund` so the rounds have cash. Threat:
  [X8](./THREAT_MODEL.md#x8-wind-down).

### P10. Capital sent to the custodian

- **Source:** `Deployed` and `Funded` on the vault; `net_deployed()` on the
  vault.
- **Threshold:** a `Deployed` that is not on treasury's plan.
- **Severity:** Warning when unplanned; Info otherwise. **Told:** treasury,
  governance.
- **Response:** `deploy_to_custodian` moves only free reserve, and only to the
  stored custodian. An unplanned one means treasury's keys may be compromised:
  governance revokes the treasury (instant). Threat:
  [R7](./THREAT_MODEL.md#r7-treasury-compromised).

### P11. Compliance acts on a holder

- **Source:** `AddressFrozen`, `TokensFrozen`, `TokensUnfrozen`,
  `LegalTransfer` and `RecoverySuccess` on the share token.
- **Threshold:** every one.
- **Severity:** Warning for a freeze or an unfreeze; Critical for a legal
  transfer or a recovery. **Told:** compliance, governance.
- **Response:** match each one to a case in compliance's records. A legal
  transfer or a recovery carries both compliance's and governance's signatures,
  so both confirm the case. Threats:
  [R9](./THREAT_MODEL.md#r9-compliance-compromised),
  [R10](./THREAT_MODEL.md#r10-compliance-and-governance-move-a-holders-shares-together).

### P12. The token's rules or verifier change

- **Source:** `ComplianceSet` and `IdentityVerifierSet` on the share token;
  `ModuleAdded`, `ModuleRemoved`, `TokenBound` and `TokenUnbound` on the kit's
  compliance contract.
- **Threshold:** every one.
- **Severity:** Critical. **Told:** governance, compliance.
- **Response:** after setup these come from applied changes (P7). A module that
  refuses can block exits, and unbinding the token stops every share move.
  Threats: [X6](./THREAT_MODEL.md#x6-a-compliance-module-blocks-exits),
  [R11](./THREAT_MODEL.md#r11-swapping-the-tokens-compliance-contract-or-verifier).

### P13. Wiring drift

- **Source:** `health()` on the vault. On a live vault, `setup_open` is false
  and every other flag is true. `feed_valid` and `freshness_covers_notice` are
  V2 and V3.
- **Threshold:** any other flag false, or `setup_open` true on a vault meant to
  be live.
- **Severity:** Critical. **Told:** governance.
- **Response:** [Health View](./kit-spec.md#health-view) says what each flag
  means. `sole_token_manager` false means another account can mint shares
  ([R1](./THREAT_MODEL.md#r1-governance-compromised-the-changes-that-wait)).
  `allowlisted` false holds delisted holders' conversions until the vault is
  listed again. Threat:
  [R3](./THREAT_MODEL.md#r3-setup-left-open-or-wired-wrong).

## Storage lifetime

An archived contract instance refuses every call, so an archived vault instance
stops the vault. Each kit call renews what it touches, but an idle deployment
can still archive
([X11](./THREAT_MODEL.md#x11-storage-that-expires),
[kit spec §5](./kit-spec.md#5-storage-lifetime-ttl-policy)).

### T1. Instance or code close to archiving

- **Source:** RPC `getLedgerEntries` for each contract's instance and each Wasm
  it runs, the deposit asset's contract included: compare `liveUntilLedgerSeq`
  with the latest ledger. `stellar ledger entry fetch` reads the same value.
- **Threshold:** Warning when fewer than 7 days (120,960 ledgers) remain.
  Critical under 2 days (34,560 ledgers), or once archived.
- **Told:** on call.
- **Response:** run
  `STELLAR_ACCOUNT=<funded account> npm run extend -w scripts/harness`. It
  restores what has archived and extends each instance, its Wasm and each
  pending change by 30 days. Any funded account can pay; it needs no authority.

### T2. Pending change close to archiving

- **Source:** the ids in `pending_changes()` on the vault, the share token, the
  oracle and the compliance contract; each one's entry through
  `getLedgerEntries`, with the key `npm run extend` builds.
- **Threshold:** as in T1.
- **Severity:** Warning. **Told:** on call.
- **Response:** `npm run extend`, as in T1. Nothing is lost if it archives: the
  call that applies it restores it and pays for the restore.

Balances, roles and other entries are restored by the call that needs them, so
the plan does not watch them. A production compliance module or identity
registry must extend its own entries.

## Events the plan reads

Event names are as in the code; the topic is what `getEvents` filters on.
`Paused`, `Unpaused`, the role and admin events, and the freeze, recovery,
rules and module events come from OpenZeppelin's Stellar libraries.

| Event | Topic | Contract | Signals |
| --- | --- | --- | --- |
| `NavAttested` | `nav_attested` | Oracle | V4, V5, V7 |
| `LatestCleared` | `latest_cleared` | Oracle | V6, V7 |
| `NavPausedSet` | `nav_paused_set` | Oracle | P2 |
| `ConfigSet` | `config_set` | Oracle | P8 |
| `EpochClosed`, `EpochFulfilled` | `epoch_closed`, `epoch_fulfilled` | Vault | C5, C6 |
| `Deployed`, `Funded` | `deployed`, `funded` | Vault | C1, P10 |
| `Paused`, `Unpaused` | `paused`, `unpaused` | Vault, share token | P1, P3 |
| `RoleGranted`, `RoleRevoked` | `role_granted`, `role_revoked` | Vault, share token, oracle | P4 |
| `AdminTransferInitiated`, `AdminTransferCompleted` | `admin_transfer_initiated`, `admin_transfer_completed` | Vault, share token, oracle, compliance | P5 |
| `ChangeProposed`, `ChangeApplied`, `ChangeCancelled` | `change_proposed`, `change_applied`, `change_cancelled` | Vault, share token, oracle, compliance | P6, P7 |
| `DepositCapUpdated`, `NoticeSet`, `WindDownDelaySet`, `CustodianSet` | `deposit_cap_updated`, `notice_set`, `wind_down_delay_set`, `custodian_set` | Vault | P8 |
| `WindDownProposed`, `WindDownProposalCancelled`, `WindDownActivated`, `WindDownRoundFinalized` | `wind_down_proposed`, `wind_down_proposal_cancelled`, `wind_down_activated`, `wind_down_round_finalized` | Vault | P9 |
| `AddressFrozen`, `TokensFrozen`, `TokensUnfrozen`, `LegalTransfer`, `RecoverySuccess` | `address_frozen`, `tokens_frozen`, `tokens_unfrozen`, `legal_transfer`, `recovery_success` | Share token | P11 |
| `ComplianceSet`, `IdentityVerifierSet` | `compliance_set`, `identity_verifier_set` | Share token | P12 |
| `ModuleAdded`, `ModuleRemoved`, `TokenBound`, `TokenUnbound` | `module_added`, `module_removed`, `token_bound`, `token_unbound` | Compliance | P12 |
| `clawback`, `set_authorized` | `clawback`, `set_authorized` | Deposit asset | C4 |

## What this plan does not cover

- **Running it.** The kit has no watcher and sends no alert.
- **The evidence behind a report.** The plan says when to check a report's
  `proof_hash` and `proof_uri`. Checking them against the valuation happens off
  chain ([O10](./THREAT_MODEL.md#o10-the-proof-proves-nothing-on-chain)).
- **The authorities' accounts.** A change to an authority's signers or
  thresholds is a Stellar account operation, not a contract event
  ([R4](./THREAT_MODEL.md#r4-an-authoritys-keys)). Watch each authority's
  account through an account-history service.
- **The allowlist.** The identity verifier in this repository is a testnet stub
  and publishes no event when `allow` lists or delists an address. A production
  identity registry has its own events.
- **External contracts.** An external compliance contract or identity registry
  keeps its own governance and storage.
- **The custodian and the issuer.** What the custodian holds, and what the
  deposit asset's issuer does beyond C4.
- **The RPC and the frontend.** Whether the RPC is up and serves its full
  window, and who hosts the frontend.
- **Tuned values.** The defaults have not been tried on a live mainnet vault.

## From plan to alerts

1. Write each threshold for the deployment, from
   [the parameters](#parameters-the-thresholds-read), into the watcher's
   settings.
2. Run a watcher that polls `getEvents` with a cursor and the getters, inside
   the RPC's retention window, and stores what it reads.
3. Route each severity: Critical pages on call and the named signers, Warning
   goes to a shared channel, Info goes to a log.
4. On a testnet deployment, make each signal fire, for example by pausing the
   NAV or posting a report near its cap, and check that the alert arrives.
5. Push alerts to operators are planned after v1
   ([design doc §11](./strata-product-and-architecture.md#11-potential-future-features)).
