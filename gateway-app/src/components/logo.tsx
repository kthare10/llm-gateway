export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="LLM Gateway logo"
    >
      {/* Left pillar */}
      <rect x="12" y="24" width="10" height="32" rx="2" fill="currentColor" />
      {/* Right pillar */}
      <rect x="42" y="24" width="10" height="32" rx="2" fill="currentColor" />
      {/* Connecting arc */}
      <path
        d="M12 28C12 14 52 14 52 28"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
