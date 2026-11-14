/** ShipLee's mark: a parcel drawn on a pine square, and the name beside it. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M16 7.5 24 11.75v8.5L16 24.5 8 20.25v-8.5Z" fill="none" stroke="var(--on-brand)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M8.3 11.9 16 16l7.7-4.1M16 16v8.2" fill="none" stroke="var(--on-brand)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
