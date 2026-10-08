/** A speech bubble with a handset: our own drawing, so it works in any colour and claims nothing about a brand. */
export function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20l1.2-4.1A8 8 0 1 1 8.2 19L4 20Z" />
      <path d="M9.2 8.6c.2-.4.5-.4.8-.3l.9 2c.1.3 0 .5-.2.7l-.5.6c.6 1.2 1.5 2 2.7 2.6l.6-.5c.2-.2.5-.2.7-.1l1.9.9c.3.2.3.5.1.9-.4.8-1.2 1.2-2 1-2.9-.7-5.1-2.9-5.8-5.8-.2-.7.2-1.5.8-2Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
