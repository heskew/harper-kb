/**
 * OAuth Metadata Endpoints
 *
 * Serves RFC 9728 Protected Resource Metadata and RFC 8414 Authorization
 * Server Metadata at their well-known URLs.
 */

import type { HarperRequest } from '../types.ts';
import { getBaseUrl } from '../http-utils.ts';

const SCOPES = ['mcp:read', 'mcp:write'];

/**
 * Handle GET /.well-known/oauth-protected-resource/<kbId>
 *
 * RFC 9728 — tells MCP clients where to find the authorization server
 * and what scopes are supported. Each KB has its own protected resource
 * metadata so the resource URL is scoped to that KB.
 */
export function handleProtectedResourceMetadata(request: HarperRequest, kbId: string): Response {
	const baseUrl = getBaseUrl(request);

	return jsonResponse(200, {
		resource: `${baseUrl}/mcp/${kbId}`,
		authorization_servers: [baseUrl],
		scopes_supported: SCOPES,
		bearer_methods_supported: ['header'],
		resource_name: 'Knowledge Base MCP Server',
	});
}

/**
 * Handle GET /.well-known/oauth-authorization-server
 *
 * RFC 8414 — describes the authorization server's capabilities,
 * endpoints, and supported grant types.
 */
export function handleAuthServerMetadata(request: HarperRequest): Response {
	const baseUrl = getBaseUrl(request);

	return jsonResponse(200, {
		issuer: baseUrl,
		authorization_endpoint: `${baseUrl}/mcp-auth/authorize`,
		token_endpoint: `${baseUrl}/mcp-auth/token`,
		registration_endpoint: `${baseUrl}/mcp-auth/register`,
		jwks_uri: `${baseUrl}/mcp-auth/jwks`,
		scopes_supported: SCOPES,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		token_endpoint_auth_methods_supported: ['none'],
		code_challenge_methods_supported: ['S256'],
		service_documentation: `${baseUrl}/`,
	});
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=3600',
		},
	});
}
