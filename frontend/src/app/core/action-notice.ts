import { signal } from '@angular/core';

/** Short-lived feedback for contact and user actions. */
export class ActionNotice {
  readonly message = signal('');
  readonly isError = signal(false);
  private timer?: ReturnType<typeof setTimeout>;

  show(message: string, isError = false): void {
    this.clear();
    this.message.set(message);
    this.isError.set(isError);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    this.timer = setTimeout(() => this.clear(), 4000);
  }

  clear(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.message.set('');
    this.isError.set(false);
  }

  destroy(): void {
    this.clear();
  }
}
