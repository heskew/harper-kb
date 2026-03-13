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
 *     onAccessCheck: async ({ user, kbId, resource, operation, channel }) => {
 *       // custom authorization logic for REST and MCP
 *       return { allow: true };
 *     },
 *   });
 */

import type { ValidatedCaller } from './oauth/validate.ts';

// ============================================================================
// Hook Types
// ============================================================================

export interface AccessCheckContext {
	/** Authenticated user (null if anonymous) */
	user: { id?: string; username?: string; role?: string } | null;
	/** Knowledge base ID being accessed */
	kbId: string | null;
	/** Resource name (e.g., 'Knowledge', 'Triage', 'KnowledgeBase') */
	resource: string;
	/** Read or write operation */
	operation: 'read' | 'write';
	/** Request channel */
	channel: 'rest' | 'mcp';
	/** MCP caller info (only present for channel: 'mcp') */
	caller?: ValidatedCaller;
}

export interface AccessCheckResult {
	/** Whether to allow access */
	allow: boolean;
	/** Override the caller's scopes (e.g., downgrade to read-only). MCP only. */
	scopes?: string[];
	/** Reason for denial (logged, not exposed to client) */
	reason?: string;
}

export interface KnowledgeHooks {
	/**
	 * Universal access check for REST and MCP requests.
	 *
	 * Called before every resource operation (get, post, put, delete) and
	 * before MCP request processing.
	 *
	 * Return { allow: false } to deny access (results in 401/403).
	 * Return { allow: true, scopes: [...] } to override granted scopes (MCP).
	 * If not registered, default behavior applies (public reads, role-based writes).
	 */
	onAccessCheck?: (context: AccessCheckContext) => Promise<AccessCheckResult>;

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
 * Run the onAccessCheck hook for a resource operation.
 *
 * Returns null if no hook is registered (use default behavior).
 * Returns the AccessCheckResult otherwise.
 */
export async function checkAccess(context: AccessCheckContext): Promise<AccessCheckResult | null> {
	if (!hooks.onAccessCheck) return null;
	return hooks.onAccessCheck(context);
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
