import { createRouter, createWebHistory } from 'vue-router';

import { useSessionStore } from '@/stores/session';

const routes = [
	{
		path: '/login',
		name: 'login',
		component: () => import('@/views/LoginView.vue'),
		meta: { public: true },
	},
	{
		path: '/',
		name: 'tasks',
		component: () => import('@/views/TasksListView.vue'),
	},
];

/**
 * Pure so it can be tested without driving a router: returns `true` to allow,
 * or a path to redirect to.
 */
export function authGuard(to) {
	const session = useSessionStore();

	if (!session.isAuthenticated && !to.meta.public) {
		return '/login';
	}

	if (session.isAuthenticated && to.meta.public) {
		return '/';
	}

	return true;
}

export const router = createRouter({
	history: createWebHistory(),
	routes,
});

router.beforeEach(authGuard);

export default router;
