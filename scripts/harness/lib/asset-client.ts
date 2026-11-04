import { BindingGenerator, StrKey, xdr, type rpc } from "@stellar/stellar-sdk"

// The SDK gives out its Stellar Asset Contract spec only after a lookup, which this answers.
const stellarAssetLookup = {
	getLedgerEntries(key: xdr.LedgerKey) {
		const instance = new xdr.ScContractInstance({
			executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
			storage: null,
		})
		const val = xdr.LedgerEntryData.contractData(
			new xdr.ContractDataEntry({
				ext: new xdr.ExtensionPoint(0),
				contract: key.contractData().contract(),
				key: key.contractData().key(),
				durability: xdr.ContractDataDurability.persistent(),
				val: xdr.ScVal.scvContractInstance(instance),
			}),
		)
		return Promise.resolve({ entries: [{ key, val }] })
	},
} as unknown as rpc.Server

export const stellarAssetGenerator = (): Promise<BindingGenerator> =>
	BindingGenerator.fromContractId(
		StrKey.encodeContract(Buffer.alloc(32)),
		stellarAssetLookup,
	)
