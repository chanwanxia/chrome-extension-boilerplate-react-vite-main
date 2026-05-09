export const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);

export const isCreateErrorEventRequest = value => {
  if (!isRecord(value)) return false;
  if (typeof value.message !== 'string') return false;
  if (typeof value.occurredAt !== 'string') return false;
  if (typeof value.runtime !== 'string') return false;
  if (typeof value.source !== 'string') return false;
  if (typeof value.severity !== 'string') return false;
  return true;
};
