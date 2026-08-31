import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from '@/App.vue';
import router from '@/router';
import { createTasksRemote } from '@/lib/tasksRemote';
import { useSessionStore } from '@/stores/session';
import { useRemote } from '@/stores/tasks';

const app = createApp(App);

app.use(createPinia()).use(router);

// The real remote is installed once, here, on the session's api instance so a
// 401 anywhere clears the session. Tests inject a fake through the same seam.
useRemote(createTasksRemote({ api: useSessionStore().api }));

app.mount('#app');
