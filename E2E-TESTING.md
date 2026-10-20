# E2E testing on testnet

A fresh testnet deployment of `main` at `45e0e23`, seeded with a known state for end-to-end and manual testing.

These are **testnet-only** keys. They hold no real value. Never reuse them on mainnet.

- Network: Stellar testnet (`https://soroban-testnet.stellar.org`)
- Deployed: 2026-10-20T18:45:08.110Z (ledger 5299664)
- Machine-readable copy: `scripts/harness/deployed.testnet.json` (gitignored, local to the deployer)

## Contracts

| Contract | Address |
| --- | --- |
| `compliance` | `CCUKJYBN5KBCOX43RUPQPIPXMHLG2DT5WKAQA67BYDO7HPUWDGCOKJUR` |
| `identity_verifier` | `CA3SPHMKVYLVODOD7YMB2SYPOFAYATHNMFPQ4INFCEXTIMAWYXRDKFU4` |
| `share_token` | `CBJVWDMYIK2ZTN3XPXVRV3OXRHX6GN4BKDXGDHFYGP2XKFM5H5OBIRAF` |
| `nav_oracle` | `CBV2X3SRCIVWTQ5OHX3FIBTHF5YO4KSUJKXHLD4FVDZGDMEYPOAOBXTS` |
| `async_vault` | `CANQQHXL7W5NCQFSWP457EEP7FXR3PUWZZDO7APFKJ72SZYXMJ77ET7G` |
| `asset` (USDC SAC) | `CDILNUCY2KIO6UE4J2MKJYEM2G2DJ5PBZDR7JYUJUXZ7LXG6L7JNSFDL` |

USDC: code `USDC`, issuer `GA35PEYTIHOJWYYMEFOSTLLQYJD3NJLFRNP56XSRLNLW7YAQEC5ALQLX`.

## Seeded state

Produced by `HARNESS_NETWORK=testnet npm run seed` in `scripts/harness`.

- Epoch #1: holder-1 deposited 5,000 USDC and holder-2 3,000 USDC at a NAV of $1.00. Both claimed their shares.
- Treasury moved 4,000 USDC to the custodian.
- Epoch #2 is **open** with two pending requests:
  - holder-1: redeem 1,000 shares
  - holder-3: deposit 2,500 USDC

| Metric | Value |
| --- | --- |
| Vault liquid USDC | 6,500 (4,000 free reserve + 2,500 pending escrow) |
| Custodian | 4,000 USDC |
| Total value (NAV basis) | 8,000 USDC |
| Latest NAV | $1.00 |

## Accounts

Import a secret key into a wallet (e.g. Freighter, set to testnet) to act as that role. All accounts are funded with testnet XLM. Holders are allowlisted.

| Role | Public key | Secret key | USDC | Shares | Notes |
| --- | --- | --- | --- | --- | --- |
| **deployer** | `GAYUAX4KX7UTEFDEH74ZQ4UVFFHIDI4QQMZBG5HGROB2RWT43ETODZ2D` | `SCCXUU65HAO763EWNTKDB34RAWP2AXCPNCHUAD5J6NVMQIS77ZPT2JNT` | 0 | 0 | Deployed the contracts. No role after setup. |
| **governance** | `GBKHGH6YL67A7BJK2EMUHVVW5SVRQPFM4UGQPTSTP5RZPFSVAS5DEKQB` | `SBTXJRZWYI3UROKMMLBD2RLMYIXLGAMIIPICAUPQMVA4L6KFLPM4INU3` | 0 | 0 | Admin: upgrades, timelock config, custodian, role grants. |
| **manager** | `GBM4K7KKPTYX7VYQ3OMZXNSJBXRMYC3Y5NY7QUGXV3Q2N2CWLZ6TGP4U` | `SAXJN6H4PCIQUYD4J6L3IUHL2P7UACRKBYCQPTZTKIJCMQZV6JAXDSWY` | 0 | 0 | Closes epochs (`close_epoch`). |
| **treasury** | `GDXJFM42WBF3PY5DRDIKYFN7NCEMJOYAZCVZ724H7FYNA52D4B67OVTD` | `SBCI3NC7T2VTBRI4XFILDK5NX2RWSZI3EEANQE6OE4L6L5Q4XUB4VKUI` | 0 | 0 | Moves capital to the custodian (`deploy_to_custodian`). |
| **guardian** | `GC6RITGKYFPPPFISVDYTLOMI5N2O5NXIPWXXZJE66KJ44TAQWOGS7X7L` | `SAPHVL77L7VNRAWIEMBIJB7T5GB2Y3DP4BHLXQSRYZCL4T2SBLVFF5H5` | 0 | 0 | Pauses the vault and the oracle. |
| **compliance** | `GA7PI44ZKEZGJBRNFMWUPSI7RHLDE5SZGJS7JJY3VS7QA3QQKSN5JGXH` | `SABRR7WK7SW77JSMBQODJ5QQK52H7F42C7T7333XM6FGDAZUVQUPV4EH` | 0 | 0 | Allowlists identities (identity verifier admin) and freezes shares (share token compliance authority). |
| **attester** | `GAEVLCCCP37SOINVUSQ3O7PEMT3IUSWL6CWQSR4IW6KSA7QMCGJYP555` | `SDINAZ6PYB2EEWA3IH4TINXO2OGHJVEBKB5OA42YAAZ2BUEWOGKC77EI` | 0 | 0 | Attests NAV reports on the oracle. |
| **custodian** | `GBWRU6F5VBZCD2VTBZALUF5FRDR5532R5343KIAU2O6V6OLL7R7VJK63` | `SCDEZ545RZTWLWIZRI6FZCIIFUYZUO4D5GHN3P4ZRIVNIN7467GSD7PK` | 4,000 | 0 | Off-chain custodian. Receives deployed capital. |
| **issuer** | `GA35PEYTIHOJWYYMEFOSTLLQYJD3NJLFRNP56XSRLNLW7YAQEC5ALQLX` | `SALYIQ74ZJJD4AKVNWQWAVDOWDL5IJYVMV4EOSK6YUIRWETBSME2LZP7` | 0 | 0 | Issues the test USDC. |
| **holder-1** | `GBWHFQWQBELRT4FP4TP3DOYPTTTZKTH6CXJAVK7ZKY6W6SXR6U4733OF` | `SARGZUA34SWPZJU43VK24EO5W5FTMCBVIFLNWILWRKB3G6TIVPHZD6JG` | 45,000 | 4,000 | Investor. 4,000 liquid shares + 1,000 pending redeem in epoch #2. |
| **holder-2** | `GDNAITVEJZ45ITSUANJJK5FN7PKHB5KFZPZLKH5JB57BNVGKR576FPOE` | `SBKHH4Z6J275PMTA4HLUBRO37H54ZB7F4NBURW3EDM5XRRR55CPLTUHJ` | 47,000 | 3,000 | Investor. Shares claimed from epoch #1. |
| **holder-3** | `GCES4U4XR3CFTLSDYK4BRJEWVVWSP5NKFYXLNRIIXCW2SV35SSUAHJ6A` | `SB7XGSJUGL7VUQPQKBNBMKXYYOCGTSZFHKZWAQIHQX544TFVWVQFMY7V` | 47,500 | 0 | Investor. 2,500 USDC pending deposit in epoch #2. |
| **outsider** | `GDO3FXQIDRWYKOLAAKWLEUZRHIPJLTWFTFSLJBQ4R4A3FRAAPVXSMPRD` | `SAEH6PLTQTWSKYCX5XYOOKZH6HRQRSYI4P346QIYXR4R45PCZXG3WVO3` | 0 | 0 | No role. Permissionless calls (`fulfill_epoch`) and reads. |

## Redeploying

```sh
nix develop
stellar contract build
cd scripts/harness
HARNESS_NETWORK=testnet npm run deploy
HARNESS_NETWORK=testnet npm run seed
```

The deploy creates new accounts and contracts, so update this file afterwards.
