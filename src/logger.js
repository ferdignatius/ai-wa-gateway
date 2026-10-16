export function log(event, fields = {}) {
  const safe = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...safe }));
}

export function logError(event, error, fields = {}) {
  log(event, { ...fields, error: error?.message ?? String(error), error_name: error?.name });
}
