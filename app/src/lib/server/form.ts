/** Reading a form the way every action does: a field is text or it is
 *  nothing. A file where text was expected is nothing, not "[object File]". */
export function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
}
