import { type AddressRow } from "../components/vault/AddressList"
import { addresses } from "./addresses"

export const vaultContractId: string = addresses.async_vault

export const contractRows: AddressRow[] = [
	{ label: "Vault", source: "config", address: addresses.async_vault },
	{ label: "Share token", source: "config", address: addresses.share_token },
	{ label: "NAV oracle", source: "config", address: addresses.nav_oracle },
	{ label: "Asset", source: "config", address: addresses.asset },
	{
		label: "Identity verifier",
		source: "config",
		address: addresses.identity_verifier,
	},
	{ label: "Compliance", source: "config", address: addresses.compliance },
]
