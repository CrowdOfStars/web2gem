export function isPromiseLike(value: unknown): value is Promise<void> {
	return !!value && typeof (value as Promise<void>).then === "function";
}
