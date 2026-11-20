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
	notices: string[]
} {
	let text: string | undefined
	try {
		text = readFile(file)
	} catch {
		text = undefined
	}

	let previous: AssetList | undefined
	const notices: string[] = []
	if (text === undefined)
		notices.push(
			`note: no previous ${file}; starting at version 1.0. If a list is already hosted, save it at ${file} first.`,
		)
	else {
		try {
			previous = JSON.parse(text) as AssetList
		} catch {
			notices.push(
				`warning: ${file} is not valid JSON; starting at version 1.0`,
			)
		}
	}

	const { list, missing, warnings } = buildAssetList(inputs, operator, previous)
	notices.push(...warnings)
	if (list === undefined) return { wrote: false, missing, notices }
	writeFile(file, `${JSON.stringify(list, null, 2)}\n`)
	return { wrote: true, missing, notices }
}
