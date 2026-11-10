---
status: accepted
---

# A SEP-40 feed that follows the vault

Integrators read a vault's share price through SEP-40, the Stellar price-feed
interface. We expose it from a separate contract, one per vault, that stores
only the vault's address and asks the vault for its oracle, asset and share
token on every call. The choices below are hard to change once integrators
depend on the feed's address and answers.

## A separate contract that follows the vault

SEP-40 asks for a feed address that never changes. Governance can swap the
vault's oracle, so a feed built into the oracle would get a new address with
every swap. A feed built into the vault would add code to the most critical
contract for a read that most deployments may never use. A separate feed that
reads `vault.oracle()` on every call keeps one address for the vault's whole
life and picks up a swap on the next call.

The feed stores no admin either. Each upgrade call reads the vault's current
`governance()` and asks it to sign, the same way the feed reads the oracle. A
vault admin hand-over therefore carries over to the feed with no step of its
own, and the feed can never be left with a stale admin. Upgrades wait for the
vault's timelock, and the feed has no other admin power.

Consequences: each quote costs about nine calls into other contracts, and the
feed serves whatever oracle governance installs, with no delay of its own.
Whoever holds the vault's governance also upgrades the feed, and a vault that
cannot name its governance leaves the feed with no way to upgrade.

## No price while a wind-down is active

`lastprice` answers only while the oracle reports `Valid` and no wind-down is
active. Once a wind-down is active, holders are paid a pro-rata share of the
cash that comes back, not the NAV, so the NAV no longer says what a share is
worth. A vault pause or a proposed wind-down keeps the price: the attested
value still stands, and a pause can be lifted.

Consequences: integrators get `None` when a wind-down starts, and must handle
it.

## The resolution is the freshness window, and the timestamp is not rounded

`resolution()` returns the current oracle's `freshness_duration`, and
`PriceData.timestamp` is the report's `attested_at`. The feed has no fixed
ticks: a report stands for at most `freshness_duration` after the oracle
accepts it, which is the honest period — the attester can set an earlier
expiry (`contracts/nav-oracle/src/lib.rs:632-634`). SEP-40's text rounds the
timestamp down to a multiple of the resolution and says the resolution never
changes. We depart from both. Rounding would make a fresh report look older
than it is, and the resolution changes when governance changes the window or
swaps the oracle.

Consequences: a consumer that reads the resolution once and keeps it can be
wrong after such a change. It should check the timestamp against the ledger
time on every read.

## The latest report only

`price(asset, ts)` returns the latest report when `attested_at ≤ ts ≤ now`
and `ts < attested_at + freshness_duration`, and `prices(asset, n)` returns at
most that one report. The oracle keeps a single report, and a feed that kept
history would store prices, which this feed never does. An old NAV is also not
a price anyone can buy or sell at today. A time later than the ledger gets no
price: the report may expire or be paused before then, so the feed cannot know
the price at that time.

Consequences: no time-weighted average can be built from this feed alone.

## 14 decimals at the edge, WAD inside

`decimals()` is 14, as Stellar price feeds use. The kit keeps the NAV in WAD
(18 decimals), so the feed converts at the edge:
`nav_per_share × 10^(share decimals − asset decimals) / 10^4`, rounded down.
An overflow, or a result of zero or less, gives no price. Moving the NAV
itself to 14 decimals is a separate decision.

Consequences: precision below 10^-14 of an asset unit per share is lost, and a
share whose value rounds to zero has no price.
