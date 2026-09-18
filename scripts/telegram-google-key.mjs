// Detect the standard Google API key format before interpreting a message as a
// link, invitation or edit. Only the boolean leaves this function.
export function containsGoogleApiKey(message) {
  const values = [message?.text, message?.caption,
    ...(message?.entities || []).map((entity) => entity.url),
    ...(message?.caption_entities || []).map((entity) => entity.url)];
  return values.some((value) => typeof value === 'string'
    && /(?:^|[^A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/.test(value));
}
