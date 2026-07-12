export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const workerCount = Math.max(
		1,
		Math.min(Math.floor(concurrency) || 1, items.length),
	);
	const workers = Array.from({ length: workerCount }, async () => {
		while (true) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= items.length) return;
			results[index] = await mapper(items[index] as T, index);
		}
	});
	await Promise.all(workers);
	return results;
}
