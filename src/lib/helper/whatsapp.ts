const INVITE_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]{8,64}$/;

export function cleanWhatsappLink(input: string): string {
  const raw = (input || '').trim();
  if (!raw) return '';

  // Allow pasting without the protocol
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const u = new URL(withProtocol);
    if (u.hostname.toLowerCase() !== 'chat.whatsapp.com') return raw;
    const path = u.pathname.replace(/\/+$/, ''); // drops ?query, #hash, trailing slash
    return `https://chat.whatsapp.com${path}`;
  } catch {
    return raw;
  }
}

export function isValidWhatsappLink(link: string): boolean {
  return !link || INVITE_RE.test(link);
}