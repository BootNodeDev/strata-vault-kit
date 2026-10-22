# Test & deploy harness

Deploys the vault contracts to a network and runs integration tests.

## Usage

```sh
# Create or complete the account keys, without deploying
npm run keys

# Deploy contracts (local or testnet)
npm run deploy

# Unit tests of the harness itself, no network needed
npm run test:unit

# Run test suites
npm run test:happy-path
npm run test:guards
```

`HARNESS_NETWORK` picks the network: `local` (the default) or `testnet`.

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

`deployed.<network>.json` records the deployed contract IDs and the accounts,
secrets included. A new deploy keeps the previous record as
`deployed.<network>.<timestamp>.json`, named after the time of that deploy,
instead of overwriting it. Git ignores these files too.

Test reports write to `runs/<network>.json`.
