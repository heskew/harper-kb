/**
 * Me Resource
 *
 * Public endpoint that returns the current user's session info.
 * Reads from the Harper session cookie — no extra state tracked.
 *
 * Routes:
 *   GET /me — returns current authenticated user or { authenticated: false }
 */

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

export class MeResource extends getResourceClass() {
	static loadAsInstance = false;

	get() {
		const context = this.getContext();

		// Check for OAuth session (via @harperfast/oauth)
		const oauthUser = context?.session?.oauthUser;
		if (oauthUser) {
			return {
				authenticated: true,
				username: oauthUser.username,
				name: oauthUser.name,
				provider: oauthUser.provider,
			};
		}

		// Check for Harper user (Basic auth or session-based)
		const user = context?.user;
		if (user) {
			const username = typeof user === 'string' ? user : user.username || user.id;
			return {
				authenticated: true,
				username,
				provider: 'harper',
			};
		}

		return { authenticated: false };
	}
}
