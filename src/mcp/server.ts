/**
 * MCP Server Middleware
 *
 * Creates an HTTP middleware for Harper's scope.server.http() that handles
 * MCP (Model Context Protocol) requests as direct JSON-RPC.
 *
 * Each knowledge base gets its own MCP endpoint at /mcp/<kbId>.
 * The kbId is extracted from the URL path, validated against the
 * KnowledgeBase table, and passed to all tools implicitly via the caller.
 *
 * Auth: Validates JWT Bearer tokens issued by the co-located OAuth 2.1
 * authorization server. Tokens are scoped to a specific KB via the
 * audience claim (aud = "{baseUrl}/mcp/{kbId}"). Unauthenticated
 * requests get read-only access.
 */

import { handleJsonRpc } from './protocol.ts';
import { validateMcpAuth, type ValidatedCaller } from '../oauth/validate.ts';
import { getKnowledgeBase } from '../core/knowledge-base.ts';
import { checkAccess } from '../hooks.ts';
import { readBody, getBaseUrl } from '../http-utils.ts';
import type { HarperRequest } from '../types.ts';

/**
 * Extract the kbId from the URL path.
 *
 * Matches: /mcp/<kbId> or /mcp/<kbId>/...
 * Returns null if the path doesn't match.
 */
function extractKbIdFromPath(pathname: string): string | null {
	const match = pathname.match(/^\/mcp\/([^/]+)/);
	return match ? match[1] : null;
}

/**
 * Create an MCP middleware function for Harper's scope.server.http().
 *
 * The middleware:
 * 1. Checks if the request pathname starts with /mcp/
 * 2. Extracts kbId from the path
 * 3. Validates the KB exists
 * 4. Validates Bearer token (scoped to this KB)
 * 5. Handles the MCP request via JSON-RPC dispatch
 */
export function createMcpMiddleware(): (
	request: HarperRequest,
	next: (req: HarperRequest) => Promise<unknown>
) => Promise<unknown> {
	return async (request: HarperRequest, next: (req: HarperRequest) => Promise<unknown>): Promise<unknown> => {
		const pathname = request.pathname || '';

		// Only handle /mcp/<kbId> routes (bare /mcp passes through)
		if (!pathname.startsWith('/mcp/')) {
			return next(request);
		}

		// Extract kbId from the path
		const kbId = extractKbIdFromPath(pathname);
		if (!kbId) {
			return next(request);
		}

		// Validate the KB exists
		const kb = await getKnowledgeBase(kbId);
		if (!kb) {
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32001,
						message: `Knowledge base not found: ${kbId}`,
					},
					id: null,
				}),
				{
					status: 404,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Validate JWT Bearer token (if present), scoped to this KB
		const { caller, hasToken } = await validateMcpAuth(request, kbId);

		// Invalid token → 401 so the client re-authenticates
		if (hasToken && !caller) {
			const baseUrl = getBaseUrl(request);
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32001,
						message: 'Unauthorized',
					},
					id: null,
				}),
				{
					status: 401,
					headers: {
						'Content-Type': 'application/json',
						'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/${kbId}"`,
					},
				}
			);
		}

		// No token → anonymous read-only; valid token → authenticated caller
		const effectiveCaller: ValidatedCaller = caller ?? {
			userId: 'anonymous',
			clientId: 'anonymous',
			scopes: ['mcp:read'],
			kbId,
		};

		// Run the onAccessCheck hook (if registered by the parent app)
		const accessResult = await checkAccess({
			user:
				effectiveCaller.userId !== 'anonymous'
					? { id: effectiveCaller.userId, username: effectiveCaller.userId }
					: null,
			kbId,
			resource: 'mcp',
			operation: 'read',
			channel: 'mcp',
			caller: effectiveCaller,
		});
		if (accessResult && !accessResult.allow) {
			logger?.warn?.(
				`Access denied for ${effectiveCaller.userId} on KB ${kbId}: ${accessResult.reason || 'denied by hook'}`
			);
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32001,
						message: 'Forbidden',
					},
					id: null,
				}),
				{
					status: 403,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Hook may override scopes (e.g., downgrade to read-only)
		const finalCaller: ValidatedCaller = accessResult?.scopes
			? { ...effectiveCaller, scopes: accessResult.scopes }
			: effectiveCaller;

		try {
			const bodyText = await readBody(request);
			const body = bodyText ? JSON.parse(bodyText) : undefined;

			const response = await handleJsonRpc(body, finalCaller);

			// Notification (no id) → 202 Accepted
			if (response === null) {
				return new Response(null, { status: 202 });
			}

			return new Response(JSON.stringify(response), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (error) {
			logger?.error?.('MCP request handling failed:', (error as Error).message, (error as Error).stack);

			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32603,
						message: 'Internal server error',
					},
					id: null,
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	};
}
