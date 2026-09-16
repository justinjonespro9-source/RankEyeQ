/** Inline medal/award mark for podium finishes — no emoji. */
export function PodiumMedal({
  place,
  className = "",
}: {
  place: 1 | 2 | 3;
  className?: string;
}) {
  const fill =
    place === 1 ? "#D4A017" : place === 2 ? "#9AA3AF" : "#C47A3A";
  const stroke =
    place === 1 ? "#8A6A0A" : place === 2 ? "#5B6572" : "#7A4A22";

  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <circle cx="12" cy="10" r="6.25" fill={fill} stroke={stroke} strokeWidth="1.25" />
      <path
        d="M9.2 15.4 8 21l4-2.2L16 21l-1.2-5.6"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <text
        x="12"
        y="12.2"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        fill={stroke}
        fontFamily="system-ui, sans-serif"
      >
        {place}
      </text>
    </svg>
  );
}
