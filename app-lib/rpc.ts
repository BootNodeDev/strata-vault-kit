import { Server } from "@stellar/stellar-sdk/rpc"
import { rpcUrl, stellarNetwork } from "./env"

const READ_TIMEOUT_MS = 3_000

export const server = new Server(rpcUrl, {
	allowHttp: stellarNetwork === "LOCAL",
})

type PostConfig = NonNullable<Parameters<Server["httpClient"]["post"]>[2]>

const { httpClient } = server
const post = httpClient.post.bind(httpClient)

// A retried submission could land twice, and a slow status poll is not a failed
// transaction, so neither gets a timeout or a retry.
const UNBOUNDED_METHODS: unknown[] = [
	"sendTransaction",
	"getTransaction",
	"getTransactions",
]

const isUnbounded = (body: unknown): boolean =>
	typeof body === "object" &&
	body !== null &&
	"method" in body &&
	UNBOUNDED_METHODS.includes(body.method)

const isHttpStatus = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"response" in error &&
	error.response !== undefined

const postWithin = async <T>(
	url: string,
	body: unknown,
	config: PostConfig | undefined,
) => {
	let timer: ReturnType<typeof setTimeout> | undefined
	const cancelToken = new httpClient.CancelToken((cancel) => {
		timer = setTimeout(() => cancel("timed out"), READ_TIMEOUT_MS)
	})
	try {
		return await post<T>(url, body, { ...config, cancelToken })
	} finally {
		clearTimeout(timer)
	}
}

httpClient.post = async <T>(
	url: string,
	body?: unknown,
	config?: PostConfig,
) => {
	if (isUnbounded(body)) return post<T>(url, body, config)
	try {
		return await postWithin<T>(url, body, config)
	} catch (error) {
		if (isHttpStatus(error)) throw error
		// Stalls cluster, so a retry cut at the same timeout would fail loads that
		// only needed to wait.
		return post<T>(url, body, config)
	}
}
