import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import ConfirmModal from '@/components/ConfirmModal.vue';

function mountModal(props = {}) {
	return mount(ConfirmModal, {
		props: { title: 'Delete “Buy milk”?', confirmLabel: 'Delete', ...props },
		attachTo: document.body,
	});
}

const buttonNamed = (wrapper, label) =>
	wrapper.findAll('button').find((button) => button.text() === label);

describe('confirming', () => {
	it('emits confirm when the action is taken', async () => {
		const wrapper = mountModal();

		await buttonNamed(wrapper, 'Delete').trigger('click');

		expect(wrapper.emitted('confirm')).toHaveLength(1);
	});

	it('emits cancel from the cancel button', async () => {
		const wrapper = mountModal();

		await buttonNamed(wrapper, 'Cancel').trigger('click');

		expect(wrapper.emitted('cancel')).toHaveLength(1);
	});

	it('closes on Escape', async () => {
		const wrapper = mountModal();

		await wrapper.find('.modal').trigger('keydown', { key: 'Escape' });

		expect(wrapper.emitted('cancel')).toHaveLength(1);
	});

	it('closes on a click outside the dialog', async () => {
		const wrapper = mountModal();

		await wrapper.find('.modal').trigger('click');

		expect(wrapper.emitted('cancel')).toHaveLength(1);
	});

	it('stays open when the dialog itself is clicked', async () => {
		const wrapper = mountModal();

		await wrapper.find('.modal__dialog').trigger('click');

		expect(wrapper.emitted('cancel')).toBeUndefined();
	});
});

describe('accessibility', () => {
	it('is a labelled dialog, not an anonymous overlay', () => {
		const wrapper = mountModal();

		expect(wrapper.find('.modal__dialog').attributes('role')).toBe('dialog');
		expect(wrapper.find('.modal__dialog').attributes('aria-modal')).toBe('true');
		expect(wrapper.text()).toContain('Delete “Buy milk”?');
	});

	it('names the task, so the user is not confirming against an unlabelled dialog', () => {
		const wrapper = mountModal({ title: 'Delete “Pay rent”?' });

		expect(wrapper.text()).toContain('Pay rent');
	});

	it('focuses cancel first, so the destructive action is never the default', async () => {
		mountModal();

		await vi.waitFor(() => expect(document.activeElement.textContent.trim()).toBe('Cancel'));
	});

	it('traps Tab inside the dialog', async () => {
		const wrapper = mountModal();

		const confirm = buttonNamed(wrapper, 'Delete');
		confirm.element.focus();
		await confirm.trigger('keydown', { key: 'Tab' });

		expect(document.activeElement.textContent.trim()).toBe('Cancel');
	});

	it('traps Shift+Tab too', async () => {
		const wrapper = mountModal();

		const cancel = buttonNamed(wrapper, 'Cancel');
		cancel.element.focus();
		await cancel.trigger('keydown', { key: 'Tab', shiftKey: true });

		expect(document.activeElement.textContent.trim()).toBe('Delete');
	});

	it('returns focus to whatever opened it, so the keyboard user is not dumped at the top', async () => {
		const opener = document.createElement('button');
		opener.textContent = 'Delete task';
		document.body.appendChild(opener);
		opener.focus();

		const wrapper = mountModal();
		await vi.waitFor(() => expect(document.activeElement.textContent.trim()).toBe('Cancel'));

		wrapper.unmount();

		expect(document.activeElement).toBe(opener);
		opener.remove();
	});
});
