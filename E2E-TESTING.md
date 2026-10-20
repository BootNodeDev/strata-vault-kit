# E2E testing on testnet

Deploy fresco de `main` (`45e0e23`) en Stellar testnet, con una cuenta por persona para correr el runbook a mano.

Son keys **solo de testnet**. No tienen valor real y son públicas a propósito. No las uses nunca en mainnet.

- Red: Stellar testnet (`https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`)
- Deploy: 2026-10-20T19:02:22.970Z (ledger 5299871)

## Personas

Importá el secret en una wallet (por ejemplo Freighter, en testnet). Cada cuenta tiene unos 10.000 XLM, trustline de USDC, 50.000 USDC y está en el allowlist, así que también puede operar como holder.

| Persona | Roles | Public key | Secret key |
| --- | --- | --- | --- |
| **Maxi** | governance (admin del vault, del oracle y del share token) | `GD4E4AI7LVHIRX7QXAHQGRPABC6NFWFKHKJ6ZUAQNIGELVVN7MSFJWLF` | `SDHNHV6MEJP26WLCHC6F27XRLJ6H34R33KGKTQFECS7PYVQVB3RW2CE4` |
| **Pablo** | manager<br>guardian (vault y oracle) | `GBE43ELIMD3CUR6WMAMTCMI5UWXNFWX3GWJ3RSSIKUGJGTSRHF5X645V` | `SBW54VWPHJTS4O2VVTU4PTV5KNJZR4BXM4QOMFJAKSAC4BQM2GRQ2MDG` |
| **Luciano** | attester<br>treasury<br>custodian | `GCBLIOHMFFYK3GORQL2JIILW2YOGIGCDM6SUKX6RVF4U66E2XTXX42KW` | `SAOAAERXFPPJP4L7EUVECIHLOXIIVALC2CDD7OMIERCKWMQJ3247XUQT` |
| **Iñaky** | compliance (admin del identity verifier, autoridad de compliance del share token)<br>outsider | `GCFUDBW2N26PBMMAMI3RVTA5O2WOGJO7GCH6E4PNFAVQNRVW2YEOELXE` | `SBD4TKZWYGHJDUS237S53UEJB45QO6WUOXRABUUNUYHLKNMCYTDLCK5G` |

Luciano es a la vez treasury y custodian: `deploy_to_custodian` le manda el USDC a su propia cuenta.

## Quién firma qué

| Acción | Firma |
| --- | --- |
| `request_deposit`, `request_redeem`, `claim_*`, cancelaciones | cualquier persona (todas son holders) |
| `close_epoch` | Pablo |
| Atestar el NAV en el oracle | Luciano |
| `fulfill_epoch` | cualquiera (sin permisos); Iñaky como outsider |
| `deploy_to_custodian` | Luciano (treasury) |
| `fund` (devolver USDC al vault) | Luciano como custodian; en realidad cualquiera puede |
| Pausar / despausar el vault o el oracle | Pablo |
| Allowlist, freeze, transferencias forzadas | Iñaky |
| Parámetros, roles, custodian, upgrades (timelock), wind-down | Maxi |

## Estado inicial

- Epoch #1 **abierto**, sin requests.
- Oracle sin NAV atestado todavía.
- Custodian del vault: Luciano.
- Vault sin fondos.

## Contratos

| Contrato | Address |
| --- | --- |
| `compliance` | `CCCA6XDCXBZWWTIDYGLTL5GEHROCZTGYAIRAFA2KBO2JAWOJFU3TMZCB` |
| `identity_verifier` | `CDMV7DGGLGIWDWI4ERIBZ5YS2FZA3QVZPVUWCAWR5VBLVJMLFYCW6DML` |
| `share_token` | `CCB23VF4CSI7QNWNDOAAAVOKOLWO5EEQFZIODWEXHS6OB3MMHGFZ3VA6` |
| `nav_oracle` | `CDDRBLB3GHZGKHGFATZBKFSXC6XRVFLHNPVWHTIE67FVNDYHU2RRRNRO` |
| `async_vault` | `CAGHFSATIJHNDXQA577APGG6GF2L7Q7KP6H2IUXVW6IT3CJ2OBE3QCEB` |
| `asset` (USDC SAC) | `CAU7LDCUCLAWSJZS72B7VIPIE7FSN3T63D7MZMSSXTNLKYDYECVGH522` |

USDC: código `USDC`, issuer `GCUYFZRTNQ6WIIN5XBEYWVENKNVCBPK5BRXK4PDBCOGCYA4BZIRGMVIN`.

## Cuentas del harness

Las usan los scripts. No hacen falta para el runbook.

| Cuenta | Para qué | Public key | Secret key |
| --- | --- | --- | --- |
| deployer | Deployó los contratos. Sin rol después. | `GC7UTBTYBYIXKBX3DWURKQQJNDKM35FEBIHJN63NT5OZIJRWFUP3VEC5` | `SBTOLGY2AMHDJSDTZRMSWOVOFN236M56YO57ZIA5WTRA7QCSIJEVWUQF` |
| issuer | Emite el USDC de prueba. Usala para darle más USDC a alguien. | `GCUYFZRTNQ6WIIN5XBEYWVENKNVCBPK5BRXK4PDBCOGCYA4BZIRGMVIN` | `SBKDWFFTWAXKKZEIBG3XREEZ7KFHIUGKXNMOKLAJIW44HUUEB46GAYZA` |
| holder-1 | Holder extra. | `GB6GENHQQWI3PRD6MVDIRO72VMIJCWENMHRSJU3Z53R372K5ZPHT7ILL` | `SB5RVYBJXKNOWMNBBXGWUHYJRKW75PY7PSX56GHPKXTOB7NW22MXYMHD` |
| holder-2 | Holder extra. | `GDJ7VTRMJ5XGALSIJDV4V6PBZRQEZZ6NUQOFUDW6TNYOMZMSL536XNAK` | `SASZ5BFK2W6LOJR4UNVUHPICW4VRDYSATCQQAOF7ISPO3OZSKTTF6NVQ` |
| holder-3 | Holder extra. | `GA6PAYUT232UAQKUYJ7QWF27JQWTKOVNRUHAF6B4CI3QT3XFKQAKSTXD` | `SAR27ZG7NEIKNBIC3U2ZFEP2MUKOOLJAPFZJXT4R2ZKIGOM5GO6T3EFX` |

## Redeploy

Los roles salen de `scripts/harness/people.testnet.json`. Si existe, `deploy` usa esas keys para los roles que lista, y keys nuevas para el resto.

```sh
nix develop
stellar contract build
cd scripts/harness
HARNESS_NETWORK=testnet npm run deploy   # contratos nuevos, mismas keys de personas
HARNESS_NETWORK=testnet npm run onboard  # trustline, USDC y allowlist por persona; custodian
```

Los contratos cambian en cada deploy, así que después actualizá la tabla de contratos de este archivo.
