# Test & deploy harness

Deploys the vault contracts to a network and runs integration tests. Before it
closes setup, the deploy sets the vault's custodian and its notice to twice
the network's oracle cooldown.

## Usage

```sh
# Create or complete the account keys, without deploying
npm run keys

# Deploy contracts (local or testnet)
npm run deploy

# Unit tests of the harness itself, no network needed
npm run test:unit
```

CI runs these in the `js` job through the root `npm run test`.

```sh
# Run test suites
npm run test:happy-path
npm run test:guards
```

`HARNESS_NETWORK` picks the network: `local` (the default) or `testnet`.

Each attestation carries the SHA-256 of `docs/evidence/sample-valuation.md` and
a URL to it: the copy on `main`, or `PROOF_URI` when set.

## Account keys

The harness signs with thirteen accounts: `deployer`, `governance`, `manager`,
`treasury`, `guardian`, `compliance`, `attester`, `custodian`, `issuer`,
`holder-1`, `holder-2`, `holder-3` and `outsider`. Their secret keys live in
`.env.keys.<network>` at the repository root, one line per account.

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
the commit alone cannot reproduce the build.

Rebuild and compare on the same operating system and CPU as the deploy:

```sh
git checkout <commit>
stellar contract build   # stellar-cli 27.0.0, the toolchain in rust-toolchain.toml
shasum -a 256 target/wasm32v1-none/release/*.wasm
```

Each hash should equal the matching entry in `wasmHashes`. A build on
another platform can differ: CI's Linux build and a macOS build of the same
commit hash differently for four of the five contracts, with no build path
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
