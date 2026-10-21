import type { ClientOptions } from "@stellar/stellar-sdk/contract"

export class Client {
	constructor(public readonly options: ClientOptions) {}
}
