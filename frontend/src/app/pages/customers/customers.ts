import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, Subscription, debounceTime, distinctUntilChanged, concat, of, interval, switchMap } from 'rxjs';
import { ContactsService, MarketingPerson } from '../../core/contacts.service';
import { Customer, CustomerPayload, CustomersService } from '../../core/customers.service';
import { DispatchRecord, DispatchService } from '../../core/dispatch.service';
import { MessageThread } from '../../shared/message-thread/message-thread';

@Component({
  selector: 'app-customers',
  imports: [ReactiveFormsModule, MessageThread],
  templateUrl: './customers.html',
  styleUrls: ['../contacts/contacts.css', './customers.css'],
})
export class Customers implements OnInit, OnDestroy {
  protected readonly items = signal<Customer[]>([]);
  protected readonly marketingPersons = signal<MarketingPerson[]>([]);
  protected readonly cityOptions = signal<string[]>([]);
  protected readonly selectedMarketingPersonId = signal<number | null>(null);
  protected readonly selectedCity = signal('');
  protected readonly phoneStatus = signal<'all' | 'with_phone' | 'without_phone'>('all');
  protected readonly filterOpen = signal<'marketing' | 'city' | null>(null);
  protected readonly filterSearch = signal('');
  protected readonly filteredPeopleForFilter = computed(() => this.marketingPersons().filter((person) =>
    person.full_name.toLowerCase().includes(this.filterSearch().trim().toLowerCase())
  ));
  protected readonly filteredCities = computed(() => this.cityOptions().filter((city) =>
    city.toLowerCase().includes(this.filterSearch().trim().toLowerCase())
  ));
  protected readonly selectedMarketingName = computed(() => this.marketingPersons().find((person) => person.id === this.selectedMarketingPersonId())?.full_name || 'All marketing persons');
  protected readonly hasActiveFilters = computed(() => !!this.searchTerm() || !!this.selectedMarketingPersonId() || !!this.selectedCity() || this.phoneStatus() !== 'all');
  protected readonly personSearch = signal('');
  protected readonly personPickerOpen = signal(false);
  protected readonly filteredMarketingPersons = computed(() => this.marketingPersons().filter((person) =>
    person.full_name.toLowerCase().includes(this.personSearch().trim().toLowerCase()) ||
    person.phone_number.includes(this.personSearch().trim())
  ));
  protected chosenMarketingPerson(): MarketingPerson | undefined {
    return this.marketingPersons().find((person) => person.id === this.form.controls.marketing_person_id.value);
  }
  protected readonly searchTerm = signal('');
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly message = signal('');
  protected readonly error = signal('');
  protected readonly editing = signal<Customer | null>(null);
  protected readonly isFormOpen = signal(false);
  protected readonly deleting = signal<Customer | null>(null);
  protected readonly selectedCustomer = signal<Customer | null>(null);
  protected readonly customerHistory = signal<DispatchRecord[]>([]);
  protected readonly historySearch = signal('');
  protected readonly historyLoading = signal(false);
  protected readonly historyError = signal('');
  private readonly searchInput = new Subject<string>();
  private searchSubscription?: Subscription;
  private listSubscription?: Subscription;
  private historySubscription?: Subscription;
  private readonly customers = inject(CustomersService);
  private readonly contacts = inject(ContactsService);
  private readonly dispatch = inject(DispatchService);
  private readonly builder = inject(NonNullableFormBuilder);

  protected readonly form = this.builder.group({
    full_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(150)]],
    phone_number: ['', [Validators.pattern(/^(?:[0-9]{11,15})?$/)]],
    city: ['', [Validators.maxLength(100)]],
    other_info: ['', [Validators.maxLength(2000)]],
    marketing_person_id: [0, [Validators.min(1)]],
  });

  ngOnInit(): void {
    this.searchSubscription = this.searchInput.pipe(debounceTime(250), distinctUntilChanged()).subscribe((value) => {
      this.searchTerm.set(value);
      this.page.set(1);
      this.load();
    });
    this.contacts.listContacts('', true).subscribe({
      next: (people) => this.marketingPersons.set(people),
      error: () => this.error.set('Unable to load marketing persons.'),
    });
    this.customers.filterOptions().subscribe({ next: (options) => this.cityOptions.set(options.cities) });
    this.load();
  }

  protected search(value: string): void { this.searchInput.next(value); }

  protected load(): void {
    this.listSubscription?.unsubscribe();
    this.loading.set(true);
    this.listSubscription = this.customers.list(this.searchTerm(), this.page(), 25, {
      marketing_person_id: this.selectedMarketingPersonId(), city: this.selectedCity(), phone_status: this.phoneStatus(),
    }).subscribe({
      next: (result) => {
        const lastPage = Math.max(1, Math.ceil(result.total / 25));
        if (this.page() > lastPage) { this.page.set(lastPage); this.load(); return; }
        this.items.set(result.items);
        this.total.set(result.total);
        this.loading.set(false);
      },
      error: () => { this.error.set('Unable to load customers.'); this.loading.set(false); },
    });
  }

  protected changePage(delta: number): void {
    const next = this.page() + delta;
    if (next < 1 || next > Math.max(1, Math.ceil(this.total() / 25)) || this.loading()) return;
    this.page.set(next);
    this.load();
  }

  protected setMarketingFilter(id: number | null): void { this.selectedMarketingPersonId.set(id); this.filtersChanged(); }
  protected setCityFilter(city: string): void { this.selectedCity.set(city); this.filtersChanged(); }
  protected setPhoneFilter(status: 'all' | 'with_phone' | 'without_phone'): void { this.phoneStatus.set(status); this.filtersChanged(); }
  protected toggleFilter(filter: 'marketing' | 'city'): void {
    this.filterOpen.set(this.filterOpen() === filter ? null : filter);
    this.filterSearch.set('');
  }
  protected clearFilters(): void {
    this.selectedMarketingPersonId.set(null); this.selectedCity.set(''); this.phoneStatus.set('all');
    this.searchTerm.set(''); this.searchInput.next(''); this.filtersChanged();
  }
  private filtersChanged(): void { this.filterOpen.set(null); this.filterSearch.set(''); this.page.set(1); this.load(); }

  protected openHistory(customer: Customer): void {
    if (!customer.phone_number) return;
    this.closeHistory();
    this.selectedCustomer.set(customer);
    this.historyLoading.set(true);
    this.historySubscription = concat(of(0), interval(15000)).pipe(switchMap(() => this.dispatch.listFullHistory({ recipient_customer_id: customer.id }))).subscribe({
      next: (records) => { if (JSON.stringify(records) !== JSON.stringify(this.customerHistory())) this.customerHistory.set(records); this.historyLoading.set(false); },
      error: () => { this.historyError.set('Unable to load customer messages.'); this.historyLoading.set(false); },
    });
  }

  protected closeHistory(): void {
    this.historySubscription?.unsubscribe();
    this.selectedCustomer.set(null); this.customerHistory.set([]);
    this.historySearch.set(''); this.historyError.set(''); this.historyLoading.set(false);
  }

  protected edit(customer: Customer): void {
    this.error.set('');
    this.editing.set(customer);
    this.isFormOpen.set(true);
    this.form.setValue({
      full_name: customer.full_name, phone_number: (customer.phone_number || '').replace(/\D/g, ''), city: customer.city || '',
      other_info: customer.other_info || '', marketing_person_id: customer.marketing_person_id,
    });
    this.personSearch.set('');
    this.personPickerOpen.set(false);
  }

  protected digitsOnly(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/[^0-9]/g, '').slice(0, 15);
    input.value = digits;
    this.form.controls.phone_number.setValue(digits);
  }

  protected chooseMarketingPerson(person: MarketingPerson): void {
    if (!person.is_active) return;
    this.form.controls.marketing_person_id.setValue(person.id);
    this.personPickerOpen.set(false);
    this.personSearch.set('');
  }

  protected reset(): void {
    this.editing.set(null);
    this.isFormOpen.set(false);
    this.form.reset({ full_name: '', phone_number: '', city: '', other_info: '', marketing_person_id: 0 });
    this.personPickerOpen.set(false);
    this.personSearch.set('');
  }

  protected openAddDialog(): void {
    this.reset();
    this.error.set('');
    this.isFormOpen.set(true);
  }

  protected closeForm(): void {
    if (!this.saving()) this.reset();
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) { this.form.markAllAsTouched(); return; }
    this.error.set('');
    this.message.set('');
    this.saving.set(true);
    const value = this.form.getRawValue();
    const payload: CustomerPayload = {
      full_name: value.full_name.trim(), phone_number: value.phone_number.trim() || null,
      city: value.city.trim() || null, other_info: value.other_info.trim() || null,
      marketing_person_id: Number(value.marketing_person_id),
    };
    const request = this.editing() ? this.customers.update(this.editing()!.id, payload) : this.customers.create(payload);
    request.subscribe({
      next: () => { this.message.set(this.editing() ? 'Customer updated.' : 'Customer added.'); this.reset(); this.saving.set(false); this.load(); this.customers.filterOptions().subscribe({ next: (options) => this.cityOptions.set(options.cities) }); },
      error: (response) => { this.error.set(response.error?.detail || 'Unable to save customer.'); this.saving.set(false); },
    });
  }

  protected remove(): void {
    const customer = this.deleting();
    if (!customer || this.saving()) return;
    this.saving.set(true);
    this.customers.delete(customer.id).subscribe({
      next: () => { this.deleting.set(null); this.saving.set(false); this.message.set('Customer deleted.'); this.load(); this.customers.filterOptions().subscribe({ next: (options) => this.cityOptions.set(options.cities) }); },
      error: () => { this.error.set('Unable to delete customer.'); this.saving.set(false); },
    });
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (this.filterOpen() && target.closest('.customer-filters .filter-field')?.getAttribute('data-filter') !== this.filterOpen()) {
      this.filterOpen.set(null);
    }
    if (this.personPickerOpen() && !target.closest('.customer-dialog .person-field')) {
      this.personPickerOpen.set(false);
    }
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    if (document.querySelector('.image-expanded-backdrop')) return;
    if (this.personPickerOpen()) this.personPickerOpen.set(false);
    else if (this.filterOpen()) this.filterOpen.set(null);
    else if (this.selectedCustomer()) this.closeHistory();
    else if (this.deleting()) this.deleting.set(null);
    else if (this.isFormOpen()) this.closeForm();
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
    this.listSubscription?.unsubscribe();
    this.historySubscription?.unsubscribe();
  }
}
