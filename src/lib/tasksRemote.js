import { ApiError } from '@/lib/api';

/**
 * The only module that knows the shape of the task endpoints.
 * Framework-free: no Vue, no Pinia.
 *
 * Two server behaviours are absorbed here rather than left to callers:
 * `PUT` is a full replacement that reopens a task when `completed_at` is
 * omitted, and the completion endpoint takes no body at all.
 */
export function createTasksRemote({ api }) {
	async function listAll() {
		const data = await api.get('/tasks');

		// The endpoint returns a bare array. It answered with a { data, meta }
		// envelope while it was paginated, and tolerating both means the
		// server-side removal can land without breaking the app mid-deploy.
		if (Array.isArray(data)) {
			return data;
		}

		return data?.data ?? [];
	}

	return {
		listAll,

		get: (id) => api.get(`/tasks/${id}`),

		create: (body) => api.post('/tasks', body),

		// PATCH, not PUT: a partial body must leave the omitted fields alone.
		// The same call is therefore safe on a completed task.
		update: (id, body) => api.patch(`/tasks/${id}`, body),

		/**
		 * Full replacement. The caller must pass a complete record — every
		 * omitted field is wiped, and an omitted `completed_at` silently
		 * reopens the task.
		 */
		replace: (id, task) =>
			api.put(`/tasks/${id}`, {
				title: task.title,
				notes: task.notes,
				due_at: task.due_at,
				completed_at: task.completed_at,
			}),

		// No body. The server stamps completed_at itself and is idempotent.
		complete: (id) => api.post(`/tasks/${id}/complete`),

		reopen: (id) => api.patch(`/tasks/${id}`, { completed_at: null }),

		async remove(id) {
			try {
				return await api.del(`/tasks/${id}`);
			} catch (error) {
				// Already gone is the outcome the user asked for. Reporting it as
				// a failure would be a refusal with nothing behind it.
				if (error instanceof ApiError && error.status === 404) {
					return null;
				}

				throw error;
			}
		},
	};
}
