import React from 'react';

interface NavigationIconProps {
  disabled?: boolean;
  size?: number;
}

export const StartIcon: React.FC<NavigationIconProps> = ({ disabled = false, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Bar */}
    <rect
      x="2"
      y="3"
      width="2"
      height="10"
      fill={disabled ? 'var(--text-muted)' : 'currentColor'}
    />
    {/* Double left arrows - touching the bar */}
    <path
      d="M 4 8 L 9 3 L 9 13 Z"
      fill={disabled ? 'var(--text-muted)' : 'currentColor'}
    />
    <path
      d="M 9 8 L 14 3 L 14 13 Z"
      fill={disabled ? 'var(--text-muted)' : 'currentColor'}
    />
  </svg>
);

export const PrevIcon: React.FC<NavigationIconProps> = ({ disabled = false, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Single left arrow */}
    <path
      d="M 5.5 8 L 13.5 3 L 13.5 13 Z"
      fill={disabled ? 'var(--text-muted)' : 'currentColor'}
    />
  </svg>
);

export const NextIcon: React.FC<NavigationIconProps> = ({ disabled = false, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Single right arrow */}
    <path
      d="M 10.5 8 L 2.5 3 L 2.5 13 Z"
      fill={disabled ? 'var(--text-muted)' : 'currentColor'}
    />
  </svg>
);

export const EndIcon: React.FC<NavigationIconProps> = ({ disabled = false, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Double right arrows - touching the bar */}
    <path
      d="M 7 8 L 2 3 L 2 13 Z"
      fill={disabled ? 'var(--text-muted)' : 'currentColor'}
    />
    <path
      d="M 12 8 L 7 3 L 7 13 Z"
      fill={disabled ? 'var(--text-muted)' : 'currentColor'}
    />
    {/* Bar */}
    <rect
      x="12"
      y="3"
      width="2"
      height="10"
      fill={disabled ? 'var(--text-muted)' : 'currentColor'}
    />
  </svg>
);
