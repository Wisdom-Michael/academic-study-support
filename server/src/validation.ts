import { HttpError } from './types';

type Body = Record<string, unknown> | undefined;

/** Read a required text field from a request body, trimmed, with a maximum length. */
export function requireText(body: Body, field: string, label: string, maxLength = 255): string {
  const value = body?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `${label} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${label} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

/** Module codes look like CS201 or COMP1010A; stored in upper case. */
export function requireModuleCode(body: Body, field = 'moduleCode'): string {
  const code = requireText(body, field, 'Module code', 20).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{2,5}\d{2,4}[A-Z]?$/.test(code)) {
    throw new HttpError(400, 'Module code should look like CS201: letters followed by digits.');
  }
  return code;
}

/** Parse a route parameter such as :id into a positive integer. */
export function idParam(value: unknown, label = 'ID'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `${label} is not valid.`);
  return id;
}
