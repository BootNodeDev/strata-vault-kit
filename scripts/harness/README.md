# Test & deploy harness

Deploys the vault contracts to a network and runs integration tests. Before it
closes setup, the deploy sets the vault's custodian, its notice to twice the
network's oracle cooldown, and a minimum epoch duration of one day, so an
outsider can seal an abandoned epoch even if the manager goes silent.

## Usage

```sh
# Create or complete the account keys, without deploying
npm run keys

# Deploy contracts (local or testnet)
npm run deploy

# Generate the share token's SEP-1 stellar.toml from a deployment (reads only)
npm run sep1

# Unit tests of the harness itself, no network needed
npm run test:unit
```

CI runs these in the `js` job through the root `npm run test`.

`npm run deploy:feed` adds a SEP-40 feed to a set deployed before the feed
existed. It reads every other contract already in the record and deploys only
the feed, bound to that record's vault; it writes the updated record and, on
testnet, `environments.toml` and the README addresses table, the same as
`npm run deploy` does. `npm run extend` covers the feed like any other
contract in the record: it needs no changes once the feed is in it.

```sh
# Run test suites
npm run test:happy-path
npm run test:guards

# The redemption queue on a seeded deployment (`npm run seed`); prints each
# transaction as `tx <label> <hash>`
npm run test:queue

# Deploys the sep40-consumer example and reads the feed through it,
# attesting a fresh NAV first if the current one is stale; prints its
# contract id and `tx record_price <hash>`
npm run test:sep40

# A wind-down on a vault it deploys for itself; local network only
npm run test:wind-down
```

`HARNESS_NETWORK` picks the network: `local` (the default) or `testnet`.

Each attestation carries the SHA-256 of `docs/evidence/sample-valuation.md` and
a URL to it: the copy on `main`, or `PROOF_URI` when set.

### Running one scenario

The scenarios share the deployment in `deployed.<network>.json`, so each one
starts from what earlier runs left there. CI runs them in this order on a new
local network: `deploy`, `test:happy-path`, `test:sep40`, `test:guards`,
`test:wind-down`.

`test:happy-path`, `test:sep40`, `test:guards` and `test:wind-down` each pass
right after `npm run deploy`. What each one expects:

- `test:happy-path` expects the holders to hold no USDC yet. Run it before
  `test:guards` and `npm run seed`, which pay them.
- `test:happy-path` and `test:guards` price their epochs at a NAV of 2.00,
  and move the oracle there first. The oracle takes a fall of any size, but refuses a rise of more than
  10% over its last report (`max_up_bps`), even a stale one. From a lower
  price they climb in 10% steps, one per oracle cooldown (5 seconds locally,
  60 on testnet). From 1.00 that takes eight reports.
- `test:sep40` reads whatever price the feed holds. When the feed is stale it
  posts the last price again, or 1.00 when there is none.
- `test:wind-down` deploys a vault of its own and leaves the deployment alone.

`test:queue` does not pass after `deploy` alone: it redeems shares that
`npm run seed` gives holder-2. The seed subscribes the holders only while
epoch 1 is open, so run `npm run seed` right after `npm run deploy`, then
`test:queue`. The seed leaves requests in the open epoch on purpose, and
`test:queue` seals and prices that epoch before it starts.

A run that stops partway can leave the NAV paused or an epoch sealed but not
priced. Deploy again before the next run.

## Account keys

The harness signs with fourteen accounts: `deployer`, `governance`, `manager`,
`treasury`, `guardian`, `compliance`, `compliance-backup`, `attester`,
`custodian`, `issuer`, `holder-1`, `holder-2`, `holder-3` and `outsider`.
Their secret keys live in `.env.keys.<network>` at the repository root, one
line per account.

`compliance-backup` holds the share token's `compliance` role as a cold spare
and signs nothing in the tests.

- The first deploy creates the file, with a new key for every account.
- Later deploys reuse the keys in the file. A deploy adds a key only for an
  account that has none, and never replaces one.
- A deploy does not fund an account that already exists on the network, and
  reuses the deposit asset contract the issuer already has.
- `npm run keys` creates or completes the file without deploying, and prints
  each account's public key. It never prints a secret.

Back the file up, and never commit it. Git ignores it, so `git clean -x`
deletes it.

To use a key you already hold for one account, write its line before the first
deploy, then let `npm run keys` add the others. From the repository root:

```sh
echo 'HOLDER_1_SECRET=S...' >> .env.keys.testnet
HARNESS_NETWORK=testnet npm run keys -w scripts/harness
```

Each line is the account name in capitals, with `_` for `-`, then `_SECRET`:
`DEPLOYER_SECRET`, `HOLDER_1_SECRET`, `OUTSIDER_SECRET`. The harness stops and
names the line if a secret is not a valid Stellar secret key, an account
appears twice, or two accounts share a key. Lines it does not know stay in the
file.

## Deployment records

`deployed.<network>.json` records the deployed contract IDs and each account's
**public** key. It holds no secret key. `.env.keys.<network>` is the only
harness file that does. Every script that signs reads it, and stops if a key
there is not the one the deployment was made with.

Records written by older versions of the harness also hold each account's
secret key. Keep a record while you still use its deployment. Make sure
`.env.keys.<network>` holds the same keys (copy any missing one from the
record's `secret` field, as `HOLDER_1_SECRET=S...`), then remove the `secret`
fields. Delete old timestamped records you no longer need.

A new deploy keeps the previous record as
`deployed.<network>.<timestamp>.json`, named after the time of that deploy,
instead of overwriting it. Git ignores these files too.

A deploy that stops after creating a contract leaves
`deployed.<network>.incomplete.json` with the IDs created so far. The next
deploy stops and names it; move or delete it to deploy a new set. The last
complete record is left alone.

### Checking a deployment against the source

The record keeps `commit`, the commit checked out when the deploy ran, and
`wasmHashes`, the SHA-256 of each Wasm file it deployed. The deploy does not
rebuild, so build right before you deploy. With `uncommittedChanges: true`,
the commit alone cannot reproduce the build. A feed added later with
`npm run deploy:feed` was built at its own commit: rebuild `sep40_feed` at
`feedCommit` (and check `feedUncommittedChanges` the same way).

Rebuild and compare on the same operating system and CPU as the deploy:

```sh
git checkout <commit>
stellar contract build   # stellar-cli 27.0.0, the toolchain in rust-toolchain.toml
shasum -a 256 target/wasm32v1-none/release/*.wasm
```

Each hash should equal the matching entry in `wasmHashes`. A build on
another platform can differ: CI's Linux build and a macOS build of the same
commit hash differently for five of the six contracts, with no build path
in either.

To check what the network runs, which needs no rebuild:

```sh
stellar contract fetch --id <id> --rpc-url <rpc> \
  --network-passphrase "<passphrase>" --out-file fetched.wasm
shasum -a 256 fetched.wasm
```

Run `stellar contract fetch --help` for the current flags. CI prints the
hash of each contract in its main build, built on Linux x86_64.

Test reports write to `runs/<network>.json`.
