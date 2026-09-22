import { type AddressRow } from "../components/vault/AboutVault"
import { addresses } from "./addresses"

export const vaultContractId: string = addresses.async_vault

export const contractRows: AddressRow[] = [
	{ label: "Vault", address: addresses.async_vault },
	{ label: "Share token", address: addresses.share_token },
	{ label: "NAV oracle", address: addresses.nav_oracle },
	{ label: "Identity verifier", address: addresses.identity_verifier },
	{ label: "Compliance", address: addresses.compliance },
	{ label: "Deposit asset (SAC)", address: addresses.asset },
]
