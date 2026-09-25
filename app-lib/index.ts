// @stellar-scaffold/app-lib — shared, framework-agnostic layer for the UI monorepo.
// One authored copy, imported by every template (and by the generated Contract
// Clients in app-lib/clients/index.ts). Framework-specific code (providers,
// stores, UI components) stays in each template.

export * from "./contracts" // AsyncVaultApi, connectAsyncVault
export * from "./env" // rpcUrl, networkPassphrase, stellarNetwork, horizonUrl, network, labPrefix
export * from "./format" // shortAddress, formatNetworkName, networkStatus, NetworkState
export * from "./friendbot" // getFriendbotUrl
export * from "./readContract" // ContractRead, readContract
export * from "./subscription" // subscribeToEvents
export * from "./wallet" // connectWallet, disconnectWallet, profileModal, signTransaction, onWalletChange, fetchBalances, wallet, MappedBalances, WalletState
