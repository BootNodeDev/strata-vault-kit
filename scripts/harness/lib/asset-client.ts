import { BindingGenerator, StrKey, xdr, type rpc } from "@stellar/stellar-sdk"

// The SDK carries the Stellar Asset Contract's spec but hands it out only for a
// contract it looks up, so this answers that one lookup as a Stellar asset.
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
