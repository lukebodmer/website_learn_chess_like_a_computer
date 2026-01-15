import React from 'react';

interface ChessBoardIconProps {
  size?: number;
  className?: string;
}

export const ChessBoardIcon: React.FC<ChessBoardIconProps> = ({ size = 24, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Board border */}
    <rect
      x="2"
      y="2"
      width="20"
      height="20"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
    />

    {/* Chess board squares - alternating pattern */}
    {/* Row 1 */}
    <rect x="2" y="2" width="5" height="5" fill="currentColor" opacity="0.9" />
    <rect x="12" y="2" width="5" height="5" fill="currentColor" opacity="0.9" />

    {/* Row 2 */}
    <rect x="7" y="7" width="5" height="5" fill="currentColor" opacity="0.9" />
    <rect x="17" y="7" width="5" height="5" fill="currentColor" opacity="0.9" />

    {/* Row 3 */}
    <rect x="2" y="12" width="5" height="5" fill="currentColor" opacity="0.9" />
    <rect x="12" y="12" width="5" height="5" fill="currentColor" opacity="0.9" />

    {/* Row 4 */}
    <rect x="7" y="17" width="5" height="5" fill="currentColor" opacity="0.9" />
    <rect x="17" y="17" width="5" height="5" fill="currentColor" opacity="0.9" />
  </svg>
);

export default ChessBoardIcon;
