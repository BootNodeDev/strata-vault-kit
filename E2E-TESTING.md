# E2E testing on testnet

A fresh deploy of `main` (`45e0e23`) on Stellar testnet, with one account per person to run the runbook by hand.

These keys are **testnet only**. They have no real value and are public on purpose. Never use them on mainnet.

- Network: Stellar testnet (`https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`)
- Deploy: 2026-10-20T19:02:22.970Z (ledger 5299871)

## People

Import the secret into a wallet (for example Freighter, on testnet). Each account has about 10,000 XLM, a USDC trustline and 100,000 USDC, and is on the allowlist, so it can also act as a holder.

| Person | Roles | Public key | Secret key |
| --- | --- | --- | --- |
| **Maxi** | governance (admin of the vault, the oracle and the share token)<br>USDC admin (can mint) | `GD4E4AI7LVHIRX7QXAHQGRPABC6NFWFKHKJ6ZUAQNIGELVVN7MSFJWLF` | `SDHNHV6MEJP26WLCHC6F27XRLJ6H34R33KGKTQFECS7PYVQVB3RW2CE4` |
| **Pablo** | manager<br>guardian (vault and oracle) | `GBE43ELIMD3CUR6WMAMTCMI5UWXNFWX3GWJ3RSSIKUGJGTSRHF5X645V` | `SBW54VWPHJTS4O2VVTU4PTV5KNJZR4BXM4QOMFJAKSAC4BQM2GRQ2MDG` |
| **Luciano** | attester<br>treasury<br>custodian | `GCBLIOHMFFYK3GORQL2JIILW2YOGIGCDM6SUKX6RVF4U66E2XTXX42KW` | `SAOAAERXFPPJP4L7EUVECIHLOXIIVALC2CDD7OMIERCKWMQJ3247XUQT` |
| **Iñaky** | compliance (admin of the identity verifier, compliance authority of the share token)<br>outsider | `GCFUDBW2N26PBMMAMI3RVTA5O2WOGJO7GCH6E4PNFAVQNRVW2YEOELXE` | `SBD4TKZWYGHJDUS237S53UEJB45QO6WUOXRABUUNUYHLKNMCYTDLCK5G` |

Luciano is both treasury and custodian: `deploy_to_custodian` sends the USDC to Luciano's own account.

## Who signs what

| Action | Signer |
| --- | --- |
| `request_deposit`, `request_redeem`, `claim_*`, cancellations | anyone (every person is a holder) |
| `close_epoch` | Pablo |
| Attest the NAV on the oracle | Luciano |
| `fulfill_epoch` | anyone (no permission needed); Iñaky as outsider |
| `deploy_to_custodian` | Luciano (treasury) |
| `fund` (return USDC to the vault) | Luciano as custodian; in fact anyone can |
| Pause / unpause the vault or the oracle | Pablo |
| Allowlist, freeze, forced transfers | Iñaky |
| Parameters, roles, custodian, upgrades (timelock), wind-down | Maxi |
| Mint USDC (`mint` on the USDC contract) | Maxi |

## Initial state

- Epoch #1 **open**, with no requests.
- No NAV attested on the oracle yet.
- Vault custodian: Luciano.
- The vault holds no funds.

## Contracts

| Contract | Address |
| --- | --- |
| `compliance` | `CCCA6XDCXBZWWTIDYGLTL5GEHROCZTGYAIRAFA2KBO2JAWOJFU3TMZCB` |
| `identity_verifier` | `CDMV7DGGLGIWDWI4ERIBZ5YS2FZA3QVZPVUWCAWR5VBLVJMLFYCW6DML` |
| `share_token` | `CCB23VF4CSI7QNWNDOAAAVOKOLWO5EEQFZIODWEXHS6OB3MMHGFZ3VA6` |
| `nav_oracle` | `CDDRBLB3GHZGKHGFATZBKFSXC6XRVFLHNPVWHTIE67FVNDYHU2RRRNRO` |
| `async_vault` | `CAGHFSATIJHNDXQA577APGG6GF2L7Q7KP6H2IUXVW6IT3CJ2OBE3QCEB` |
| `asset` (USDC SAC) | `CAU7LDCUCLAWSJZS72B7VIPIE7FSN3T63D7MZMSSXTNLKYDYECVGH522` |

USDC: code `USDC`, issuer `GCUYFZRTNQ6WIIN5XBEYWVENKNVCBPK5BRXK4PDBCOGCYA4BZIRGMVIN`. The issuer handed the USDC contract's admin to Maxi, so Maxi is the one who mints.

If your wallet shows two USDC assets, use this issuer's. The other one is from an earlier deploy.

## Harness accounts

The scripts create them. The holders work as extra investors in the runbook.

| Account | Purpose | Public key | Secret key |
| --- | --- | --- | --- |
| deployer | Deployed the contracts. No role afterwards. | `GC7UTBTYBYIXKBX3DWURKQQJNDKM35FEBIHJN63NT5OZIJRWFUP3VEC5` | `SBTOLGY2AMHDJSDTZRMSWOVOFN236M56YO57ZIA5WTRA7QCSIJEVWUQF` |
| issuer | Issuer of the test USDC. No longer the contract's admin; Maxi mints. | `GCUYFZRTNQ6WIIN5XBEYWVENKNVCBPK5BRXK4PDBCOGCYA4BZIRGMVIN` | `SBKDWFFTWAXKKZEIBG3XREEZ7KFHIUGKXNMOKLAJIW44HUUEB46GAYZA` |
| holder-1 | Holder: 100,000 USDC, trustline and allowlist. | `GB6GENHQQWI3PRD6MVDIRO72VMIJCWENMHRSJU3Z53R372K5ZPHT7ILL` | `SB5RVYBJXKNOWMNBBXGWUHYJRKW75PY7PSX56GHPKXTOB7NW22MXYMHD` |
| holder-2 | Holder: 100,000 USDC, trustline and allowlist. | `GDJ7VTRMJ5XGALSIJDV4V6PBZRQEZZ6NUQOFUDW6TNYOMZMSL536XNAK` | `SASZ5BFK2W6LOJR4UNVUHPICW4VRDYSATCQQAOF7ISPO3OZSKTTF6NVQ` |
| holder-3 | Holder: 100,000 USDC, trustline and allowlist. | `GA6PAYUT232UAQKUYJ7QWF27JQWTKOVNRUHAF6B4CI3QT3XFKQAKSTXD` | `SAR27ZG7NEIKNBIC3U2ZFEP2MUKOOLJAPFZJXT4R2ZKIGOM5GO6T3EFX` |

## Redeploy

The roles come from `scripts/harness/people.testnet.json`. If it exists, `deploy` uses those keys for the roles it lists, and new keys for the rest.

```sh
stellar contract build
cd scripts/harness
HARNESS_NETWORK=testnet npm run deploy   # new contracts, the same people's keys
HARNESS_NETWORK=testnet npm run onboard  # trustline, USDC and allowlist for each person; custodian
```

For Maxi to mint, the issuer hands over the USDC contract's admin (the values come from `deployed.testnet.json` and `people.testnet.json`):

```sh
stellar contract invoke --network testnet --id <asset> --source-account <issuer secret> -- set_admin --new_admin <Maxi public>
stellar contract invoke --network testnet --id <asset> --source-account <Maxi secret> -- mint --to <holder> --amount 1000000000000  # 100,000 USDC (7 decimals)
```

holder-1..3 need a trustline and the allowlist before the mint.

The contracts change on every deploy, so update this file's contract table afterwards.
