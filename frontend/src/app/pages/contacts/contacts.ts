import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ContactsService, MarketingPerson } from '../../core/contacts.service';

@Component({
  selector: 'app-contacts',
  imports: [ReactiveFormsModule],
  templateUrl: './contacts.html',
  styleUrl: './contacts.css',
})
export class Contacts implements OnInit {
  protected readonly contacts = signal<MarketingPerson[]>([]);
  protected readonly searchTerm = signal('');
  protected readonly editingContact = signal<MarketingPerson | null>(null);
  protected readonly isSaving = signal(false);
  protected readonly message = signal('');
  protected readonly isErrorMessage = signal(false);
  protected readonly filteredContacts = computed(() => this.contacts());

  private readonly contactsService = inject(ContactsService);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly contactForm = this.formBuilder.group({
    full_name: ['', [Validators.required, Validators.minLength(2)]],
    phone_number: ['', [Validators.required, Validators.minLength(10)]],
  });

  protected readonly editForm = this.formBuilder.group({
    full_name: ['', [Validators.required, Validators.minLength(2)]],
    phone_number: ['', [Validators.required, Validators.minLength(10)]],
    is_active: [true],
  });

  ngOnInit(): void {
    this.loadContacts();
  }

  protected loadContacts(): void {
    this.contactsService.listContacts(this.searchTerm()).subscribe({
      next: (contacts) => this.contacts.set(contacts),
      error: () => this.showMessage('Unable to load contacts.', true),
    });
  }

  protected search(value: string): void {
    this.searchTerm.set(value);
    this.loadContacts();
  }

  protected saveContact(): void {
    this.clearMessage();

    if (this.contactForm.invalid || this.isSaving()) {
      this.contactForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    const payload = {
      ...this.contactForm.getRawValue(),
      is_active: true,
    };

    this.contactsService.createContact(payload).subscribe({
      next: () => {
        this.showMessage('Contact created.');
        this.contactForm.reset({
          full_name: '',
          phone_number: '',
        });
        this.isSaving.set(false);
        this.loadContacts();
      },
      error: (error) => {
        this.showMessage(error.error?.detail ?? 'Unable to save contact.', true);
        this.isSaving.set(false);
      },
    });
  }

  protected editContact(contact: MarketingPerson): void {
    this.editingContact.set(contact);
    this.editForm.setValue({
      full_name: contact.full_name,
      phone_number: contact.phone_number,
      is_active: contact.is_active,
    });
  }

  protected updateContact(): void {
    this.clearMessage();
    const editing = this.editingContact();

    if (!editing || this.editForm.invalid || this.isSaving()) {
      this.editForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    this.contactsService.updateContact(editing.id, this.editForm.getRawValue()).subscribe({
      next: () => {
        this.showMessage('Contact updated.');
        this.closeEditDialog();
        this.isSaving.set(false);
        this.loadContacts();
      },
      error: (error) => {
        this.showMessage(error.error?.detail ?? 'Unable to update contact.', true);
        this.isSaving.set(false);
      },
    });
  }

  protected setSuspendedStatus(isSuspended: boolean): void {
    const editing = this.editingContact();
    if (!editing || this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    this.contactsService.updateContact(editing.id, { is_active: !isSuspended }).subscribe({
      next: () => {
        this.showMessage(isSuspended ? 'Contact suspended.' : 'Contact unsuspended.');
        this.closeEditDialog();
        this.isSaving.set(false);
        this.loadContacts();
      },
      error: () => {
        this.showMessage(isSuspended ? 'Unable to suspend contact.' : 'Unable to unsuspend contact.', true);
        this.isSaving.set(false);
      },
    });
  }

  protected closeEditDialog(): void {
    this.editingContact.set(null);
    this.editForm.reset({
      full_name: '',
      phone_number: '',
      is_active: true,
    });
  }

  private showMessage(message: string, isError = false): void {
    this.message.set(message);
    this.isErrorMessage.set(isError);
  }

  private clearMessage(): void {
    this.message.set('');
    this.isErrorMessage.set(false);
  }
}
