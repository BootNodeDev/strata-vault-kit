import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type Grant } from "./useAdminAuthority"
import { type UseContractTransaction } from "./useContractTransaction"
import { usePendingTransaction } from "./usePendingTransaction"

const makeTransaction = <TArg = bigint>(
	submit: (arg: TArg, grant?: Grant) => boolean,
): UseContractTransaction<TArg, Record<never, never>> => ({
	status: { status: "idle" },
	submit,
	prepare: vi.fn(),
	reset: vi.fn(),
})

describe("usePendingTransaction", () => {
	it("starts with no pending amount label", () => {
		const { result } = renderHook(() =>
			usePendingTransaction(makeTransaction(() => true)),
		)

		expect(result.current.amountLabel).toBe("")
	})

	it("records the label and submits the argument once accepted", () => {
		const submit = vi.fn().mockReturnValue(true)
		const { result } = renderHook(() =>
			usePendingTransaction(makeTransaction(submit)),
		)

		let accepted = false
		accepted = result.current.submit(5n, "5.00 USDC")

		expect(accepted).toBe(true)
		expect(submit).toHaveBeenCalledWith(5n, undefined)
	})

	it("leaves the label unset when the underlying submit refuses", () => {
		const submit = vi.fn().mockReturnValue(false)
		const { result } = renderHook(() =>
			usePendingTransaction(makeTransaction(submit)),
		)

		const accepted = result.current.submit(5n, "5.00 USDC")

		expect(accepted).toBe(false)
		expect(result.current.amountLabel).toBe("")
	})

	it("retries with the same argument that was submitted", () => {
		const submit = vi.fn().mockReturnValue(true)
		const { result } = renderHook(() =>
			usePendingTransaction(makeTransaction(submit)),
		)

		result.current.submit(5n, "5.00 USDC")
		result.current.retry()

		expect(submit).toHaveBeenNthCalledWith(2, 5n, undefined)
	})

	it("retries with the grant that was submitted", () => {
		const submit = vi.fn().mockReturnValue(true)
		const grant: Grant = {
			role: "vault guardian",
			authority: "GAUTHORITY",
			standing: { needs: 2 },
		}
		const { result } = renderHook(() =>
			usePendingTransaction(makeTransaction(submit)),
		)

		result.current.submit(5n, "5.00 USDC", grant)
		result.current.retry()

		expect(submit).toHaveBeenNthCalledWith(2, 5n, grant)
	})

	it("retries a submission whose argument was null", () => {
		const submit = vi.fn().mockReturnValue(true)
		const { result } = renderHook(() =>
			usePendingTransaction(makeTransaction<bigint | null>(submit)),
		)

		result.current.submit(null, "No cap")
		result.current.retry()

		expect(submit).toHaveBeenNthCalledWith(2, null, undefined)
	})

	it("does nothing on retry before any submission was accepted", () => {
		const submit = vi.fn().mockReturnValue(true)
		const { result } = renderHook(() =>
			usePendingTransaction(makeTransaction(submit)),
		)

		result.current.retry()

		expect(submit).not.toHaveBeenCalled()
	})

	it("delegates reset to the underlying transaction", () => {
		const reset = vi.fn()
		const transaction = makeTransaction(() => true)
		const { result } = renderHook(() =>
			usePendingTransaction({ ...transaction, reset }),
		)

		result.current.reset()

		expect(reset).toHaveBeenCalledTimes(1)
	})

	it("prepares through the underlying transaction without recording a label", () => {
		const prepare = vi.fn()
		const transaction = makeTransaction(() => true)
		const grant: Grant = {
			role: "manager",
			authority: "GAUTHORITY",
			standing: "signs-alone",
		}
		const { result } = renderHook(() =>
			usePendingTransaction({ ...transaction, prepare }),
		)

		result.current.prepare(5n, grant)

		expect(prepare).toHaveBeenCalledWith(5n, grant)
		expect(result.current.amountLabel).toBe("")
	})
})
