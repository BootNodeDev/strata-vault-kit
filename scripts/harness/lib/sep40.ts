import { type Asset } from "../../../app-lib/clients/sep40_feed/dist/index.js"

export const stellarAsset = (id: string): Asset => ({
	tag: "Stellar",
	values: [id],
})
