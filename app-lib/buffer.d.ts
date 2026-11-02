import { type Buffer as BufferPackage } from "buffer"

// The generated clients name `Buffer` as a global; in the browser it comes from
// the `buffer` package, as in the app.
declare global {
	type Buffer = BufferPackage
}
