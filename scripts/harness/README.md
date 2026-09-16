# Test & deploy harness

Deploys the vault contracts to a network and runs integration tests.

## Usage

```sh
# Deploy contracts (local or testnet)
npm run deploy

# Run test suites
npm run test:happy-path
npm run test:guards
```

`deployed.<network>.json` records deployed contract IDs and generated accounts. Test reports write to `runs/<network>.json`.
