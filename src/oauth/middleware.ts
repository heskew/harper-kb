/**
 * OAuth Middleware
 *
 * Route dispatcher for all OAuth endpoints. Registered via
 * scope.server.http() before the MCP and webhook middlewares.
 *
 * Routes (MCP OAuth 2.1 — separate from @harperfast/oauth's /oauth/* Resource):
 *   GET  /.well-known/oauth-protected-resource/<kbId>  → per-KB resource metadata
 *   GET  /.well-known/oauth-authorization-server       → auth server metadata
 *   POST /mcp-auth/register                            → DCR
 *   GET  /mcp-auth/authorize                           → login page
 *   POST /mcp-auth/authorize                           → credential validation + redirect
 *   POST /mcp-auth/token                               → code exchange / refresh
 *   GET  /mcp-auth/jwks                                → public key set
 */

import { handleProtectedResourceMetadata, handleAuthServerMetadata } from './metadata.ts';
import { handleRegister } from './register.ts';
import { handleAuthorizeGet, handleAuthorizePost } from './authorize.ts';
import { handleToken } from './token.ts';
import { getJwks } from './keys.ts';
import type { HarperRequest } from '../types.ts';

type MiddlewareFn = (request: HarperRequest, next: (req: HarperRequest) => Promise<unknown>) => Promise<unknown>;

/**
 * Create the OAuth middleware for Harper's scope.server.http().
 */
export function createOAuthMiddleware(): MiddlewareFn {
	return async (request: HarperRequest, next: (req: HarperRequest) => Promise<unknown>): Promise<unknown> => {
		const pathname = request.pathname || '';
		const method = (request.method || 'GET').toUpperCase();

		// Well-known metadata endpoints — protected resource metadata is per-KB
		const prMatch = pathname.match(/^\/\.well-known\/oauth-protected-resource\/([^/]+)$/);
		if (prMatch && method === 'GET') {
			return handleProtectedResourceMetadata(request, prMatch[1]);
		}
		if (pathname === '/.well-known/oauth-authorization-server' && method === 'GET') {
			return handleAuthServerMetadata(request);
		}

		// MCP OAuth endpoints (under /mcp-auth/ to avoid conflict with
		// @harperfast/oauth's OAuthResource which owns the /oauth/* path)
		if (pathname === '/mcp-auth/register' && method === 'POST') {
			return handleRegister(request);
		}
		if (pathname === '/mcp-auth/authorize') {
			if (method === 'GET') {
				return handleAuthorizeGet(request);
			}
			if (method === 'POST') {
				return handleAuthorizePost(request);
			}
		}
		if (pathname === '/mcp-auth/token' && method === 'POST') {
			return handleToken(request);
		}
		if (pathname === '/mcp-auth/jwks' && method === 'GET') {
			return new Response(JSON.stringify(await getJwks()), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=3600',
				},
			});
		}

		// Not a handled route — pass through
		return next(request);
	};
}
