import { error } from '@sveltejs/kit';
import { uuidOf } from '#lib/ids.ts';

/** Reading a form the way every action does: a field is text or it is
 *  nothing. A file where text was expected is nothing, not "[object File]". */
export function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
}

/** An optional id field: empty or absent is null, and anything but a uuid
 *  is a 400 naming the field, never an id that happens not to exist. */
export function uuidIn<T extends string>(form: FormData, name: string): T | null {
  const given = text(form, name);
  if (given === '') return null;
  return uuidOf<T>(given) ?? error(400, `\`${name}\` is an id, a uuid; "${given}" is not one.`);
}

/** The same for a query parameter: absent or empty is null, anything but a
 *  uuid is a 400 naming it. */
export function uuidParam<T extends string>(url: URL, name: string): T | null {
  const given = url.searchParams.get(name)?.trim() ?? '';
  if (given === '') return null;
  return uuidOf<T>(given) ?? error(400, `\`${name}\` is an id, a uuid; "${given}" is not one.`);
}
