import { fetch } from "undici";
import type { Dispatcher } from "undici";
import type { JevHttpRequest } from "./jev-client.ts";
import type { JevHttpTransport } from "./jev-asker.ts";

/** How long one Jev request may take before it is abandoned. */
export const JEV_REQUEST_TIMEOUT_MS = 30_000;

/** Sends Jev requests over undici's fetch, optionally through a proxy dispatcher. */
export interface UndiciJevTransportOptions {
	/** Dispatcher that tunnels through Agent Vault; omit it to call TypeSafe directly. */
	dispatcher?: Dispatcher;
	/** Abort one request after this long. Defaults to {@link JEV_REQUEST_TIMEOUT_MS}. */
	timeoutMs?: number;
	/** Abort signal from the active agent turn, so Esc cancels an in-flight prune. */
	signal?: AbortSignal;
}

/** Creates the transport that posts System One requests and returns their bodies. */
export function createUndiciJevTransport(options: UndiciJevTransportOptions): JevHttpTransport {
	const timeoutMs = options.timeoutMs ?? JEV_REQUEST_TIMEOUT_MS;
	return {
		async send(request: JevHttpRequest): Promise<string> {
			const response = await fetch(request.url, {
				method: request.method,
				headers: { ...request.headers },
				body: request.body,
				signal: options.signal ?? AbortSignal.timeout(timeoutMs),
				...(options.dispatcher === undefined ? {} : { dispatcher: options.dispatcher }),
			});
			const body = await response.text();
			if (!response.ok) {
				throw new Error(`Jev request failed with ${response.status}: ${body.slice(0, 200)}`);
			}
			return body;
		},
	};
}
