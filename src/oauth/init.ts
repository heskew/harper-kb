/**
 * OAuth Initialization
 *
 * Single entry point for all OAuth setup. Called from handleApplication()
 * to initialize signing keys and register the OAuth middleware.
 *
 * Isolated here so the OAuth subsystem can be extracted into a standalone
 * plugin package without touching the main index.ts.
 */

import { ensureSigningKey } from './keys.ts';
import { createOAuthMiddleware } from './middleware.ts';
import type { Scope } from '../types.ts';

/**
 * Initialize the OAuth subsystem.
 *
 * 1. Generates or loads the RSA signing key pair
 * 2. Registers the OAuth HTTP middleware (/.well-known/*, /mcp-auth/*)
 */
export async function initOAuth(scope: Scope): Promise<void> {
	const scopeLogger = scope.logger;

	// Initialize OAuth signing keys (generates RSA key pair on first run)
	try {
		await ensureSigningKey();
	} catch (error) {
		scopeLogger?.error?.('Failed to initialize OAuth signing key:', (error as Error).message);
	}

	// Register OAuth endpoints (must be first — handles /.well-known/*, /mcp-auth/*)
	scope.server.http?.(createOAuthMiddleware());
}
