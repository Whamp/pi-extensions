import { ProxyAgent } from "undici";
import type { AgentVaultAccess } from "./agent-vault-access.ts";

/**
 * Builds the dispatcher that routes Jev requests through Agent Vault.
 *
 * The token authenticates the extension to the proxy; the CA lets the tunnel accept the
 * certificate Agent Vault presents for `api.typesafe.ai`, which is the one place the credential is
 * attached. The dispatcher is expensive to build and safe to reuse, so callers keep one for the
 * session.
 */
export function createAgentVaultDispatcher(access: AgentVaultAccess): ProxyAgent {
	return new ProxyAgent({
		uri: access.proxyUrl,
		token: `Bearer ${access.token}`,
		requestTls: { ca: access.caPem },
	});
}
