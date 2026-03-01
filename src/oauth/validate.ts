/**
 * OAuth JWT Bearer Token Validation
 *
 * Validates JWT access tokens on incoming MCP requests.
 * Verifies the signature, issuer, audience, expiration, and scope.
 *
 * Tokens are scoped to a specific KB via the audience claim:
 *   aud = "{baseUrl}/mcp/{kbId}"
 */

import { jwtVerify, createLocalJWKSet } from 'jose';
import type { HarperRequest } from '../types.ts';
import { getBaseUrl, getHeader } from '../http-utils.ts';
import { getJwks } from './keys.ts';

export interface ValidatedCaller {
	/** User identifier (from JWT sub claim, e.g. "github:octocat") */
	userId: string;
	/** OAuth client ID */
	clientId: string;
	/** Granted scopes */
	scopes: string[];
	/** Knowledge base this caller is scoped to (from URL path) */
	kbId: string;
}

export interface AuthResult {
	/** Validated caller, or null if no valid token */
	caller: ValidatedCaller | null;
	/** Whether an Authorization header with Bearer token was present */
	hasToken: boolean;
}

/**
 * Validate the Bearer token from an MCP request.
 *
 * The kbId is extracted from the URL path and used as part of the
 * expected audience claim — tokens issued for one KB cannot be used
 * on another.
 *
 * Returns { caller, hasToken } so the MCP middleware can distinguish:
 * - No token → anonymous read-only access
 * - Valid token → authenticated access with granted scopes
 * - Invalid token → 401 (token present but verification failed)
 */
export async function validateMcpAuth(request: HarperRequest, kbId: string): Promise<AuthResult> {
	const token = extractBearerToken(request);
	if (!token) return { caller: null, hasToken: false };

	try {
		const baseUrl = getBaseUrl(request);
		const jwks = createLocalJWKSet(await getJwks());

		const { payload } = await jwtVerify(token, jwks, {
			issuer: baseUrl,
			audience: `${baseUrl}/mcp/${kbId}`,
		});

		return {
			caller: {
				userId: payload.sub || 'unknown',
				clientId: (payload.client_id as string) || 'unknown',
				scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
				kbId,
			},
			hasToken: true,
		};
	} catch (error) {
		logger?.warn?.(`JWT validation failed: ${(error as Error).message}`);
		return { caller: null, hasToken: true };
	}
}

/**
 * Extract the Bearer token from the Authorization header.
 */
function extractBearerToken(request: HarperRequest): string | null {
	const authValue = getHeader(request, 'authorization');
	if (!authValue) return null;

	const match = authValue.match(/^Bearer\s+(.+)$/i);
	return match ? match[1] : null;
}
