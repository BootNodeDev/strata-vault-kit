import { use } from "react"
import { WalletContext } from "../providers/WalletProvider"

export const useWallet = () => use(WalletContext)
