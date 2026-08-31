/**
 * The HTTP client. Framework-free: no Vue, no Pinia, no router.
 *
 * Everything above this file branches on `status`, so a dropped connection is
 * reported as status 0 rather than as a thrown TypeError — "offline" and
 * "the server said no" lead to very different messages for the user.
 */

export const API_BASE = '/api/v1';

export class ApiError extends Error {
	constructor(status, message, data = null) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.data = data;
	}
}

export function isOffline(error) {
	return error instanceof ApiError && error.status === 0;
}

async function parse(response) {
	// 204 and empty bodies are normal (delete, logout) — do not try to parse them.
	if (response.status === 204) {
		return null;
	}

	const body = await response.text();

	if (!body) {
		return null;
	}

	try {
		return JSON.parse(body);
	} catch {
		// An HTML error page is still a failure with a status; falling back to
		// null keeps the status branch below in charge of the message.
		return null;
	}
}

export function createApi({ getToken = () => null, onUnauthorized = null } = {}) {
	async function request(path, { method = 'GET', body } = {}) {
		const token = getToken();

		const headers = {
			Accept: 'application/json',
		};

		// POST /tasks/{id}/complete takes no body at all, so Content-Type is set
		// only when there is something to describe.
		if (body !== undefined) {
			headers['Content-Type'] = 'application/json';
		}

		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}

		let response;

		try {
			response = await fetch(`${API_BASE}${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		} catch {
			// fetch only rejects on a network-level failure; anything the server
			// answered lands in the branch below with a real status.
			throw new ApiError(0, 'No connection to the server.');
		}

		const data = await parse(response);

		if (response.ok) {
			return data;
		}

		if (response.status === 401 && onUnauthorized) {
			onUnauthorized();
		}

		throw new ApiError(response.status, data?.message ?? `Request failed (${response.status}).`, data);
	}

	return {
		request,
		get: (path) => request(path),
		post: (path, body) => request(path, { method: 'POST', body }),
		put: (path, body) => request(path, { method: 'PUT', body }),
		patch: (path, body) => request(path, { method: 'PATCH', body }),
		del: (path) => request(path, { method: 'DELETE' }),
	};
}
