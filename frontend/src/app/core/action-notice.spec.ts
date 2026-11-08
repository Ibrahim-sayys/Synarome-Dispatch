import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionNotice } from './action-notice';

describe('ActionNotice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('scrolls to the top and clears each notice after five seconds', () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const notice = new ActionNotice();

    notice.show('Contact deleted.');
    expect(notice.message()).toBe('Contact deleted.');
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    vi.advanceTimersByTime(4999);
    expect(notice.message()).toBe('Contact deleted.');
    vi.advanceTimersByTime(1);
    expect(notice.message()).toBe('');

    notice.show('Unable to save contact.', true);
    expect(notice.isError()).toBe(true);
    vi.advanceTimersByTime(2500);
    notice.show('Contact updated.');
    vi.advanceTimersByTime(2500);
    expect(notice.message()).toBe('Contact updated.');
    vi.advanceTimersByTime(2500);
    expect(notice.message()).toBe('');
    notice.destroy();
  });
});
