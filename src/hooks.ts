/**
 * Plugin Hooks
 *
 * Exposes extension points that the parent application (or other plugins)
 * can wire into. Follows the same pattern as @harperfast/oauth's registerHooks.
 *
 * Usage from the parent app:
 *
 *   import { registerHooks } from 'harper-kb';
 *   registerHooks({
 *     onAccessCheck: async (caller, kbId) => {
 *       // custom authorization logic
 *       return { allow: true };
 *     },
 *   });
 */

import type { ValidatedCaller } from './oauth/validate.ts';

// ============================================================================
// Hook Types
// ============================================================================

export interface AccessCheckResult {
	/** Whether to allow access */
	allow: boolean;
	/** Override the caller's scopes (e.g., downgrade to read-only) */
	scopes?: string[];
	/** Reason for denial (logged, not exposed to client) */
	reason?: string;
}

export interface KnowledgeHooks {
	/**
	 * Called after JWT validation, before the MCP request is processed.
	 * Return { allow: false } to deny access (results in 403).
	 * Return { allow: true, scopes: [...] } to override granted scopes.
	 * If not registered, all authenticated users are allowed.
	 */
	onAccessCheck?: (caller: ValidatedCaller, kbId: string) => Promise<AccessCheckResult>;

	/**
	 * URL path for login redirect.
	 *
	 * Single provider:    "/oauth/github/login"  — goes straight to that provider
	 * Multiple providers: "/login"               — goes to the app's provider-selection page
	 * Not set:            credential-only login (no SSO button)
	 *
	 * The plugin appends ?redirect=... so the login page knows where to return.
	 */
	loginPath?: string;
}

// ============================================================================
// Hook Registry (module-level singleton)
// ============================================================================

let hooks: KnowledgeHooks = {};

/**
 * Register hook callbacks for the knowledge base plugin.
 *
 * Can be called multiple times — later calls merge with (and override)
 * previously registered hooks.
 */
export function registerHooks(newHooks: KnowledgeHooks): void {
	hooks = { ...hooks, ...newHooks };
}

/**
 * Run the onAccessCheck hook if registered.
 *
 * Returns null if no hook is registered (caller is allowed by default).
 * Returns the AccessCheckResult otherwise.
 */
export async function checkAccess(caller: ValidatedCaller, kbId: string): Promise<AccessCheckResult | null> {
	if (!hooks.onAccessCheck) return null;
	return hooks.onAccessCheck(caller, kbId);
}

/**
 * Get the configured login path (if any).
 */
export function getLoginPath(): string | null {
	return hooks.loginPath || null;
}

/**
 * Reset all hooks (for testing).
 */
export function _resetHooks(): void {
	hooks = {};
}
