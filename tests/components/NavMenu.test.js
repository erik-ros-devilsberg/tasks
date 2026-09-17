import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import NavMenu from '@/components/NavMenu.vue';

const mounted = (props = {}) => mount(NavMenu, { props, attachTo: document.body });

describe('the delete-mode item', () => {
	it('is offered when the list has tasks', () => {
		const wrapper = mounted({ hasTasks: true });

		expect(wrapper.find('[data-action="delete-mode"]').exists()).toBe(true);
		expect(wrapper.find('[data-action="delete-mode"]').text()).toMatch(/delete tasks/i);

		wrapper.unmount();
	});

	it('is withheld from an empty list — a mode with nothing to select is a dead end', () => {
		const wrapper = mounted({ hasTasks: false });

		expect(wrapper.find('[data-action="delete-mode"]').exists()).toBe(false);

		wrapper.unmount();
	});

	it('tells the app to enter the mode', async () => {
		const wrapper = mounted({ hasTasks: true });

		await wrapper.find('[data-action="delete-mode"]').trigger('click');

		expect(wrapper.emitted('delete-mode')).toHaveLength(1);

		wrapper.unmount();
	});
});
