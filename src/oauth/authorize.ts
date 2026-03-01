/**
 * OAuth Authorization Endpoint
 *
 * GET /mcp-auth/authorize — MCP OAuth 2.1 authorization endpoint.
 *
 * Shows a login page with an optional SSO button (configurable via the
 * loginPath hook) and a Harper credential fallback. If the user has an
 * active session (from a prior OAuth login), issues an auth code
 * immediately.
 *
 * Authorization decisions (who gets access, what scopes) are delegated
 * to the host application via the onAccessCheck hook on each MCP request.
 */

import crypto from 'node:crypto';
import type { HarperRequest } from '../types.ts';
import { readBody, parseFormBody } from '../http-utils.ts';
import { getLoginPath } from '../hooks.ts';

interface AuthorizeParams {
	client_id: string;
	redirect_uri: string;
	response_type: string;
	state: string;
	code_challenge: string;
	code_challenge_method: string;
	scope: string;
	resource: string;
}

/**
 * Handle GET /mcp-auth/authorize
 *
 * Three modes:
 * 1. Returning from login (`pending` param) — complete authorization.
 * 2. User already has a session — issue auth code directly.
 * 3. First visit — show login page.
 */
export async function handleAuthorizeGet(request: HarperRequest): Promise<Response> {
	const url = new URL(request.url || request.pathname || '/', `http://${(request as any).host || 'localhost'}`);
	const pendingId = url.searchParams.get('pending');

	// Returning from OAuth login — complete the authorization
	if (pendingId) {
		return handleAuthorizeComplete(request, pendingId);
	}

	// First visit — extract and validate OAuth params
	const params = extractParams(url.searchParams);
	const validation = await validateAuthorizeParams(params);

	if (validation.error) {
		return errorPage(validation.error);
	}

	// If user already has an OAuth session, issue code directly
	const session = (request as any).session;
	if (session?.user && session?.oauthUser) {
		return issueAuthCodeOAuth(params, session);
	}

	// Show login page
	return loginPage(params);
}

/**
 * Handle POST /mcp-auth/authorize — Harper credential login.
 */
export async function handleAuthorizePost(request: HarperRequest): Promise<Response> {
	let form: Record<string, string>;
	try {
		const rawBody = await readBody(request);
		form = parseFormBody(rawBody);
	} catch {
		return errorPage('Invalid request body');
	}

	const username = form.username || '';
	const password = form.password || '';

	// Reconstruct the OAuth params from the hidden form fields
	const params: AuthorizeParams = {
		client_id: form.client_id || '',
		redirect_uri: form.redirect_uri || '',
		response_type: form.response_type || 'code',
		state: form.state || '',
		code_challenge: form.code_challenge || '',
		code_challenge_method: form.code_challenge_method || 'S256',
		scope: form.scope || 'mcp:read mcp:write',
		resource: form.resource || '',
	};

	// Re-validate OAuth params
	const validation = await validateAuthorizeParams(params);
	if (validation.error) {
		return errorPage(validation.error);
	}

	if (!username || !password) {
		return loginPage(params, 'Username and password are required.');
	}

	// Validate credentials via Harper's built-in login
	const valid = await validateHarperCredentials(request, username, password);
	if (!valid) {
		return loginPage(params, 'Invalid username or password.');
	}

	// Issue authorization code for Harper user
	const code = crypto.randomUUID();

	await databases.kb.OAuthCode.put({
		id: code,
		clientId: params.client_id,
		userId: `harper:${username}`,
		scope: params.scope,
		codeChallenge: params.code_challenge,
		codeChallengeMethod: params.code_challenge_method,
		redirectUri: params.redirect_uri,
		resource: params.resource,
		type: 'code',
	});

	const redirectUrl = new URL(params.redirect_uri);
	redirectUrl.searchParams.set('code', code);
	redirectUrl.searchParams.set('state', params.state);

	logger?.info?.(`OAuth code issued for Harper user ${username}, client ${params.client_id}`);

	return new Response(null, {
		status: 302,
		headers: { Location: redirectUrl.toString() },
	});
}

/**
 * Complete authorization after the user returns from OAuth login.
 */
async function handleAuthorizeComplete(request: HarperRequest, pendingId: string): Promise<Response> {
	const session = (request as any).session;

	if (!session?.user) {
		return errorPage('Authentication required. Please try again.');
	}

	// Look up the stored OAuth params
	const pending = await databases.kb.OAuthCode.get(pendingId);
	if (!pending || (pending as Record<string, unknown>).type !== 'pending') {
		return errorPage('Authorization session expired. Please try again.');
	}

	// Delete the pending record (one-time use)
	await databases.kb.OAuthCode.delete(pendingId);

	// Build userId from the session's provider info
	const provider = session.oauthUser?.provider || 'oauth';
	const username = session.oauthUser?.username || session.user;
	const userId = `${provider}:${username}`;

	// Issue authorization code
	const code = crypto.randomUUID();
	const mcpClientState = pending.userId as string;

	await databases.kb.OAuthCode.put({
		id: code,
		clientId: pending.clientId as string,
		userId,
		scope: pending.scope as string,
		codeChallenge: pending.codeChallenge as string,
		codeChallengeMethod: pending.codeChallengeMethod as string,
		redirectUri: pending.redirectUri as string,
		resource: (pending.resource as string) || '',
		type: 'code',
	});

	const redirectUrl = new URL(pending.redirectUri as string);
	redirectUrl.searchParams.set('code', code);
	redirectUrl.searchParams.set('state', mcpClientState);

	logger?.info?.(`OAuth code issued for user ${userId}, client ${pending.clientId}`);

	return new Response(null, {
		status: 302,
		headers: { Location: redirectUrl.toString() },
	});
}

/**
 * Issue an auth code immediately (user already has an OAuth session).
 */
async function issueAuthCodeOAuth(params: AuthorizeParams, session: Record<string, any>): Promise<Response> {
	const provider = session.oauthUser?.provider || 'oauth';
	const username = session.oauthUser?.username || session.user;
	const userId = `${provider}:${username}`;

	const code = crypto.randomUUID();

	await databases.kb.OAuthCode.put({
		id: code,
		clientId: params.client_id,
		userId,
		scope: params.scope,
		codeChallenge: params.code_challenge,
		codeChallengeMethod: params.code_challenge_method,
		redirectUri: params.redirect_uri,
		resource: params.resource,
		type: 'code',
	});

	const redirectUrl = new URL(params.redirect_uri);
	redirectUrl.searchParams.set('code', code);
	redirectUrl.searchParams.set('state', params.state);

	logger?.info?.(`OAuth code issued for user ${userId}, client ${params.client_id}`);

	return new Response(null, {
		status: 302,
		headers: { Location: redirectUrl.toString() },
	});
}

/**
 * Validate credentials via Harper's built-in request.login().
 *
 * Authenticates directly against Harper's internal user store —
 * no HTTP call, no credentials over the wire.
 */
async function validateHarperCredentials(request: HarperRequest, username: string, password: string): Promise<boolean> {
	try {
		await (request as any).login(username, password);
		return true;
	} catch {
		return false;
	}
}

function extractParams(searchParams: URLSearchParams): AuthorizeParams {
	return {
		client_id: searchParams.get('client_id') || '',
		redirect_uri: searchParams.get('redirect_uri') || '',
		response_type: searchParams.get('response_type') || '',
		state: searchParams.get('state') || '',
		code_challenge: searchParams.get('code_challenge') || '',
		code_challenge_method: searchParams.get('code_challenge_method') || '',
		scope: searchParams.get('scope') || 'mcp:read mcp:write',
		resource: searchParams.get('resource') || '',
	};
}

async function validateAuthorizeParams(params: AuthorizeParams): Promise<{ error?: string }> {
	if (!params.client_id) {
		return { error: 'Missing required parameter: client_id' };
	}
	if (!params.redirect_uri) {
		return { error: 'Missing required parameter: redirect_uri' };
	}
	if (params.response_type !== 'code') {
		return { error: 'response_type must be "code"' };
	}
	if (!params.state) {
		return { error: 'Missing required parameter: state' };
	}
	if (!params.code_challenge) {
		return {
			error: 'Missing required parameter: code_challenge (PKCE is required)',
		};
	}
	if (params.code_challenge_method !== 'S256') {
		return { error: 'code_challenge_method must be "S256"' };
	}

	// Validate client exists
	const client = await databases.kb.OAuthClient.get(params.client_id);
	if (!client) {
		return { error: 'Unknown client_id' };
	}

	// Validate redirect_uri matches registration (exact match)
	const registeredUris = client.redirectUris as string[];
	if (!registeredUris || !registeredUris.includes(params.redirect_uri)) {
		return {
			error: 'redirect_uri does not match any registered URI for this client',
		};
	}

	return {};
}

/**
 * Build the OAuth login redirect URL, stashing OAuth params in the DB.
 * Returns null if no loginPath is configured.
 */
async function buildOAuthLoginUrl(params: AuthorizeParams): Promise<string | null> {
	const loginPath = getLoginPath();
	if (!loginPath) return null;

	const pendingId = crypto.randomUUID();
	await databases.kb.OAuthCode.put({
		id: pendingId,
		clientId: params.client_id,
		userId: params.state,
		scope: params.scope,
		codeChallenge: params.code_challenge,
		codeChallengeMethod: params.code_challenge_method,
		redirectUri: params.redirect_uri,
		resource: params.resource,
		type: 'pending',
	});

	const returnPath = `/mcp-auth/authorize?pending=${pendingId}`;
	return `${loginPath}?redirect=${encodeURIComponent(returnPath)}`;
}

/**
 * Render the login page.
 */
async function loginPage(params: AuthorizeParams, errorMsg?: string): Promise<Response> {
	const oauthLoginUrl = await buildOAuthLoginUrl(params);
	const clientName = ((await databases.kb.OAuthClient.get(params.client_id))?.clientName as string) || params.client_id;

	const errorHtml = errorMsg ? `<div class="error-msg">${escapeHtml(errorMsg)}</div>` : '';

	// Build the SSO section (only if loginPath is configured)
	const ssoSection = oauthLoginUrl
		? `<a href="${escapeAttr(oauthLoginUrl)}" class="sso-btn">Sign in</a>
  <div class="divider">or</div>
  <button type="button" class="cred-toggle" onclick="document.querySelector('.cred-form').classList.toggle('visible');this.style.display='none'">
    Sign in with credentials
  </button>`
		: '';

	// Credential form is always visible if there's no SSO, hidden behind toggle if there is
	const credFormClass = oauthLoginUrl ? 'cred-form' : 'cred-form visible';
	const credFormErrorClass = oauthLoginUrl && errorMsg ? 'cred-form visible' : credFormClass;

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize — Knowledge Base</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f1117; color: #e1e4e8;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 1rem;
  }
  .card {
    background: #1c1f26; border: 1px solid #2d333b; border-radius: 12px;
    padding: 2rem; width: 100%; max-width: 380px;
  }
  h1 { font-size: 1.15rem; font-weight: 600; margin-bottom: 0.25rem; }
  .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .client-name { color: #c9d1d9; font-weight: 500; }
  .sso-btn {
    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    width: 100%; padding: 0.7rem 1rem;
    background: #238636; color: #fff; border: none; border-radius: 6px;
    font-size: 0.95rem; font-weight: 500; cursor: pointer;
    text-decoration: none; transition: background 0.15s;
  }
  .sso-btn:hover { background: #2ea043; }
  .divider {
    display: flex; align-items: center; gap: 0.75rem;
    margin: 1.25rem 0; color: #484f58; font-size: 0.8rem;
  }
  .divider::before, .divider::after {
    content: ''; flex: 1; height: 1px; background: #2d333b;
  }
  .cred-toggle {
    display: block; width: 100%; text-align: center;
    color: #484f58; font-size: 0.8rem; background: none; border: none;
    cursor: pointer; padding: 0.25rem; transition: color 0.15s;
  }
  .cred-toggle:hover { color: #8b949e; }
  .cred-form { display: none; margin-top: 1rem; }
  .cred-form.visible { display: block; }
  label {
    display: block; color: #8b949e; font-size: 0.8rem; margin-bottom: 0.25rem;
  }
  input[type="text"], input[type="password"] {
    width: 100%; padding: 0.5rem 0.6rem;
    background: #0d1117; border: 1px solid #2d333b; border-radius: 6px;
    color: #e1e4e8; font-size: 0.9rem; margin-bottom: 0.75rem;
    outline: none; transition: border-color 0.15s;
  }
  input:focus { border-color: #58a6ff; }
  .submit-btn {
    width: 100%; padding: 0.6rem 1rem;
    background: #21262d; color: #c9d1d9; border: 1px solid #363b42;
    border-radius: 6px; font-size: 0.9rem; cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .submit-btn:hover { background: #30363d; border-color: #484f58; }
  .error-msg {
    background: #3d1214; border: 1px solid #da3633; border-radius: 6px;
    color: #f85149; font-size: 0.85rem; padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
  }
</style>
</head>
<body>
<div class="card">
  <h1>Authorize</h1>
  <p class="subtitle"><span class="client-name">${escapeHtml(clientName)}</span> wants access</p>
  ${errorHtml}
  ${ssoSection}
  <form method="POST" action="/mcp-auth/authorize" class="${credFormErrorClass}">
    <input type="hidden" name="client_id" value="${escapeAttr(params.client_id)}">
    <input type="hidden" name="redirect_uri" value="${escapeAttr(params.redirect_uri)}">
    <input type="hidden" name="response_type" value="${escapeAttr(params.response_type)}">
    <input type="hidden" name="state" value="${escapeAttr(params.state)}">
    <input type="hidden" name="code_challenge" value="${escapeAttr(params.code_challenge)}">
    <input type="hidden" name="code_challenge_method" value="${escapeAttr(params.code_challenge_method)}">
    <input type="hidden" name="scope" value="${escapeAttr(params.scope)}">
    <input type="hidden" name="resource" value="${escapeAttr(params.resource)}">
    <label for="username">Username</label>
    <input type="text" id="username" name="username" autocomplete="username" required>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <button type="submit" class="submit-btn">Sign in</button>
  </form>
</div>
</body>
</html>`;

	return new Response(html, {
		status: errorMsg ? 400 : 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'X-Frame-Options': 'DENY',
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
		},
	});
}

function errorPage(message: string): Response {
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Authorization Error</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f1117; color: #e1e4e8;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .error { background: #1c1f26; border: 1px solid #da3633; border-radius: 12px;
    padding: 2rem; max-width: 420px; }
  h1 { color: #f85149; font-size: 1.1rem; margin-bottom: 0.5rem; }
</style>
</head>
<body>
<div class="error">
  <h1>Authorization Error</h1>
  <p>${escapeHtml(message)}</p>
</div>
</body>
</html>`;

	return new Response(html, {
		status: 400,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'X-Frame-Options': 'DENY',
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
		},
	});
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
