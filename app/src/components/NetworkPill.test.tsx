import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import NetworkPill from "./NetworkPill"

describe("NetworkPill", () => {
	it("renders disconnected state with no wallet provider", () => {
		// No provider: WalletContext's default is a real object, so useWallet()
		// returns instead of throwing. Wrap this if that guard is ever fixed.
		const { container } = render(<NetworkPill />)

		const pill = container.querySelector(".network-pill")
		expect(pill?.getAttribute("title")).toBe(
			"Connect your wallet using this network.",
		)
		expect(pill?.className).toBe("network-pill")
		expect(container.querySelector(".network-dot--disconnected")).toBeTruthy()
	})
})
