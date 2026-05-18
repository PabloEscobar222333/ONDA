import { ulid } from 'ulid';

export const newId = (prefix?: string): string => (prefix ? `${prefix}_${ulid()}` : ulid());
