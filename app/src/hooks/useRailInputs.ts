import { useState } from "react"
import { type Inputs, withInput } from "../pages/actions"

export function useRailInputs() {
	const [inputs, setInputs] = useState<Inputs>({})
	const onInput = (action: { id: string }, value: string, key?: string) => {
		if (key !== undefined)
			setInputs((previous) => withInput(previous, action.id, key, value))
	}
	return { inputs, setInputs, onInput }
}
