# How the Built Kit Differs from the Grant Proposal

This note is for the Stellar Community Fund and for teams that adopt the kit.
It lists where the built kit differs from the grant proposal on purpose, what is
not built yet, and the limits an adopter should know before deploying. Each item
says what the kit does and why. Where the kit departs from the proposal, the
item says what the proposal said. Each item links to the place in this
repository that documents it: "the design doc" is
[Product and architecture](./strata-product-and-architecture.md), and "the kit
spec" is the [Kit specification](./kit-spec.md).

## Changed on purpose

1. **Claims are priced once per epoch and paid in any order.** The proposal said
   "FIFO claim priced at claim": claims paid first in, first out, each at the
   price of the moment it is claimed. The kit batches requests into epochs. It
   prices each epoch once, from a valid net asset value (NAV) report
   (`fulfill_epoch`), and every request in the epoch gets that one price. A
   priced claim pays as soon as the vault's cash covers its own amount, in any
   order. One price per epoch treats every request in it the same, and no
   holder waits behind another holder's unclaimed request. See design doc
   [§6](./strata-product-and-architecture.md#6-how-it-works) and
   [§8.4](./strata-product-and-architecture.md#84-request-lifecycle).

2. **The attester posts the whole per-share NAV.** The proposal described split
   accounting: the attester reports only the value held off chain, and the
   contract adds its own USDC balance to get the price. In the kit, the
   attester computes the full NAV per share off chain, from the value deployed
   off chain and the vault's public figures, and posts it. The oracle checks
   each report against a band of allowed prices, caps on how far the price may
   rise or fall in one report, and a cooldown between reports. A report stays
   valid for a set freshness window, and the guardian can pause the NAV in an
   emergency. The USDC the vault holds is the reserve that pays claims. It has
   its own public figures: the cash available to pay exits, the cash owed to
   priced redemptions, and any shortfall. The contract does not add it to the
   price. This keeps the price fixed between reports: moving cash to the
   custodian or back does not change it. See design doc
   [§8.5](./strata-product-and-architecture.md#85-valuation-and-accounting).

3. **The timelock is the kit's own `strata-timelock` crate.** The proposal said
   the timelock would come from OpenZeppelin. The kit needs four things
   OpenZeppelin's governance timelock does not do:
   - one clock shared by the vault, the share token, the oracle and the
     compliance contract;
   - paused time does not count, so a vault pause pushes back the time a
     queued change can apply;
   - a setup window in which changes are instant; it closes once and never
     reopens;
   - no change lands during a wind-down, except a grant of the share token's
     `compliance` role, which still waits the full delay.

   The delay is 7 to 90 days. See design doc
   [§9](./strata-product-and-architecture.md#9-relationship-to-existing-stellar-tooling).

4. **A compliance freeze holds a priced claim.** The proposal's headline rule
   is that a priced claim always pays. In the kit, a priced claim pays once the
   vault's cash covers it, for every holder who is not frozen. When the
   compliance authority freezes a holder, what the vault owes them is held
   until the freeze is lifted: not paid, not returned, and not given to anyone
   else. This follows how asset-freeze rules generally treat frozen property.
   There is one more exception. A redemption so small that it rounds down to
   zero assets pays no cash and gives the shares back, so the holder must be
   able to receive shares. If the holder has been removed from the allowlist
   (delisted), that claim waits until they are listed again. In a wind-down
   the shares are burned instead. See kit spec
   [Invariant 4](./kit-spec.md#invariant-4-covered-claims-always-pay-exit-guarantee)
   and the [compliance matrix](./COMPLIANCE_MATRIX.md#1-investor-states).

5. **New deposits stop while the price cannot be trusted or the cash is
   short.** The vault refuses a new deposit request when:
   - the NAV feed is stale (its last report expired), cleared or paused
     (`FeedNotValid`);
   - the deposit asset's issuer has taken back part of the vault's cash (a
     clawback), and the vault now holds less than the deposits still waiting
     to be priced (`EscrowNotCovered`);
   - governance has proposed a wind-down (`WindDownAlreadyProposed`).

   A new deposit should not buy shares at a price nobody vouches for, fund an
   earlier depositor's refund after a clawback, or join a vault that is about
   to close. This rule stops only new deposits. It closes no exit for money
   already in the vault. See design doc
   [§8.4](./strata-product-and-architecture.md#84-request-lifecycle).

6. **Anyone may seal an epoch once it has run a minimum time.** Sealing an
   epoch closes it to new requests so it can be priced. The manager may seal
   the open epoch at any time. Governance can also set a minimum epoch
   duration, from 1 to 30 days. Once the open epoch has been open that long,
   anyone may seal it, so pricing does not stop if the manager does. The 1-day
   floor stops outsiders from sealing a stream of tiny epochs. Whoever seals
   picks where the batch ends, not the price. Left unset, only the manager
   seals. See kit spec
   [When the Manager or the Attester Stops](./kit-spec.md#when-the-manager-or-the-attester-stops).

7. **Transfer modes are the token pause and the allowlist check on both
   sides.** The grant's admin panel lists two transfer modes: disabled, and
   allowed when both sides are allowlisted. The kit has both without a separate
   setting. "Allowed when both sides are allowlisted" is the share token's own
   check on every transfer between holders, and it is always on. "Disabled" is
   the share token's pause. Only governance pauses and unpauses the token, and
   both take effect at once. Exits stay open in either mode: the vault moves
   shares by minting, burning and forced transfer, which the pause does not
   stop. See kit spec [Transfer Modes](./kit-spec.md#transfer-modes).

## Not built yet

8. **Multisig authorities.** The proposal's Tranche 1 promised native Stellar
   multisig accounts, created and wired by script. Today the deploy script
   gives each authority a single key, not a multisig. It checks that setup has
   closed, that the vault's own wiring checks (its `health()` view) all pass,
   that the vault holds the share token's `manager` role, and that the token's
   `compliance` role has two holders. Still to come, before a mainnet
   deployment: creating the multisig accounts, checking that each authority is
   the intended multisig, checking that no key used only to deploy keeps a
   role, and reading the deposit asset's authorization flags (whether its
   issuer can freeze or claw back balances). See design doc
   [§8.10](./strata-product-and-architecture.md#810-deployment).

## Delivered as its own document

9. **On-chain monitoring plan.** The grant requires one. It is
   [`docs/MONITORING_PLAN.md`](./MONITORING_PLAN.md): what an operator watches
   on chain, where each signal comes from, and what to do when it fires.

## Limits an adopter should know

10. **Share decimals are 7, and the asset must match.** The share token is
    created with 7 decimals, and the vault's setup cannot finish unless the
    deposit asset has the same. Every classic Stellar asset, USDC included,
    has 7. A Soroban token with other decimals needs a fork of the share token.
    See kit spec
    [Deploy-Time Parameters](./kit-spec.md#deploy-time-parameters-constructor_args).

11. **An issuer clawback of the vault's cash is outside the kit's control.**
    The deposit asset's issuer can take back the vault's cash, and the kit
    cannot stop it. After a clawback the vault pays in a fixed order: first
    deposits that can still be cancelled, then priced redemptions, and only
    then anything else. Each payment it cannot cover is refused with a named
    error (`EscrowNotCovered` or `ClaimNotCovered`) until the treasury
    authority sends cash to cover the gap. The kit does not insure the loss: it
    reaches holders through the NAV the attester reports. If the issuer freezes
    the vault's balance instead, every cash exit waits until the freeze is
    lifted. See threat model
    [X10](./THREAT_MODEL.md#x10-the-deposit-assets-issuer-freezes-or-claws-back-the-vaults-cash).

12. **In a wind-down, a failing compliance module can block claims.** In a
    wind-down, a holder collects their part of the cash by surrendering
    shares, which the vault burns. The share token calls the compliance
    contract on each burn. If a compliance module (a rule plugged into the
    compliance contract) starts failing during a wind-down, those claims fail.
    The module cannot be removed then: removing it waits for the timelock, and
    no timelocked change lands in a wind-down except a `compliance` grant. A
    frozen holder's wind-down payout also waits until the compliance authority
    (a holder of the share token's `compliance` role) lifts the freeze. If that
    key is lost, granting the role to a new account waits the full timelock
    delay, at least seven days. So each deployment keeps a second `compliance`
    holder whose key is stored offline. See design doc
    [§8.7](./strata-product-and-architecture.md#87-treasury-and-custodian) and
    kit spec [§4](./kit-spec.md#4-deployment-runbook-summary).

13. **Figures counted in ledgers assume 5-second ledgers.** Most durations in
    the kit are in seconds and read the ledger's close time: the timelock
    delay, the notice, the freshness window, the cooldown, the wind-down delay
    and the minimum epoch duration. Ledger speed does not change them. A few
    figures are counted in ledgers and assume one ledger every 5 seconds,
    17,280 a day: how long contract data lives before it must be extended, the
    7 days a new admin has to accept a hand-over, and the 30 days the script
    that extends storage asks for. If the network makes ledgers faster, these
    last less time on the clock. At 2.5-second ledgers, a hand-over must be
    accepted within 3.5 days. See kit spec
    [Days and Ledgers](./kit-spec.md#days-and-ledgers).
