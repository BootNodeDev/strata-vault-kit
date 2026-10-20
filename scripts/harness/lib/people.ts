import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { Keypair } from "@stellar/stellar-sdk"

import { ACCOUNT_NAMES, type AccountName } from "./accounts.js"
import { PACKAGE_ROOT } from "./deployment.js"
import { type NetworkName } from "./network.js"

export interface Person {
	public: string
	secret: string
	roles: AccountName[]
}

export type People = Record<string, Person>

export function peopleFile(network: NetworkName): string {
	return join(PACKAGE_ROOT, `people.${network}.json`)
}

export function loadPeople(network: NetworkName): People {
	const file = peopleFile(network)
	if (!existsSync(file)) return {}
	const people = JSON.parse(readFileSync(file, "utf8")) as People
	const taken = new Map<string, string>()
	for (const [name, person] of Object.entries(people)) {
		for (const role of person.roles) {
			if (!ACCOUNT_NAMES.includes(role)) {
				throw new Error(`${name} has unknown role ${role}`)
			}
			const holder = taken.get(role)
			if (holder) throw new Error(`${role} given to both ${holder} and ${name}`)
			taken.set(role, name)
		}
	}
	return people
}

export function assignedKeys(
	people: People,
): Partial<Record<AccountName, Keypair>> {
	return Object.fromEntries(
		Object.values(people).flatMap((person) =>
			person.roles.map((role) => [role, Keypair.fromSecret(person.secret)]),
		),
	)
}
