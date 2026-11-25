import type { DispatchRecord } from '../core/dispatch.service';

export function matchesChatSearch(record: DispatchRecord, search: string): boolean {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return true;
  return [
    record.message_text,
    record.original_filename,
    record.sender?.username,
    record.recipient_name,
    record.actual_recipient,
    record.customer_name,
    record.marketing_person_name,
  ].some((value) => value?.toLocaleLowerCase().includes(term));
}
