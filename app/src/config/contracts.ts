import {
	asset,
	asyncVault,
	compliance,
	identityVerifier,
	navOracle,
	shareToken,
} from "@stellar-scaffold/app-lib/clients"
import { type AddressRow } from "../components/vault/AddressList"

export const vaultContractId: string = asyncVault.options.contractId

export const contractRows: AddressRow[] = [
	{ label: "Vault", source: "config", address: asyncVault.options.contractId },
	{
		label: "Share token",
		source: "config",
		address: shareToken.options.contractId,
	},
	{
		label: "NAV oracle",
		source: "config",
		address: navOracle.options.contractId,
	},
	{ label: "Asset", source: "config", address: asset.options.contractId },
	{
		label: "Identity verifier",
		source: "config",
		address: identityVerifier.options.contractId,
	},
	{
		label: "Compliance",
		source: "config",
		address: compliance.options.contractId,
	},
]
