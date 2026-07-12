import { handleApplicationRequest } from "./app";
import type { WorkerEnv } from "./config";

export default {
	fetch: handleApplicationRequest,
} satisfies ExportedHandler<WorkerEnv>;

export * from "./public-exports";
