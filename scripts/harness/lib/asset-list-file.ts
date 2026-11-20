import { buildAssetList, type AssetList } from "./asset-list.js"
import {
	type MissingField,
	type OperatorValues,
	type Sep1Inputs,
} from "./stellar-toml.js"

export interface WriteAssetListOptions {
	file: string
	inputs: Sep1Inputs
	operator: OperatorValues
	readFile: (file: string) => string
	writeFile: (file: string, text: string) => void
}

export function writeAssetList({
	file,
	inputs,
	operator,
	readFile,
	writeFile,
}: WriteAssetListOptions): {
	wrote: boolean
	missing: MissingField[]
	warning?: string
} {
	let text: string | undefined
	try {
		text = readFile(file)
	} catch {
		text = undefined
	}

	let previous: AssetList | undefined
	let warning: string | undefined
	if (text !== undefined) {
		try {
			previous = JSON.parse(text) as AssetList
		} catch {
			warning = `warning: ${file} is not valid JSON; starting at version 1.0`
		}
	}

	const { list, missing } = buildAssetList(inputs, operator, previous)
	if (list === undefined) {
		return { wrote: false, missing, ...(warning && { warning }) }
	}
	writeFile(file, `${JSON.stringify(list, null, 2)}\n`)
	return { wrote: true, missing, ...(warning && { warning }) }
}
