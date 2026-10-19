export const insecureContextMessage = 'Biboo needs a secure connection for this operation. Open it over trusted HTTPS, or use HTTP localhost on this device. HTTP over a Wi-Fi/LAN IP address is not a secure context.'

export class SecureContextError extends Error {
  override name = 'SecureContextError'
}

export function createId(): string {
  if (globalThis.isSecureContext === false) throw new SecureContextError(insecureContextMessage)
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new SecureContextError('Secure UUID generation is unavailable in this browser. Use an up-to-date browser over trusted HTTPS (or HTTP localhost). No data was saved.')
  }
  // Keep the native cryptographic implementation; no insecure UUID fallback.
  return globalThis.crypto.randomUUID()
}
