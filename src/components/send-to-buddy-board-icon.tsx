import React from 'react';

interface SendToBuddyBoardIconProps {
  size?: number;
  className?: string;
}

export const SendToBuddyBoardIcon: React.FC<SendToBuddyBoardIconProps> = ({
  size = 24,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Chess board — bigger and centered */}
    <g transform="translate(5, 5)">
      <rect
        x="0"
        y="0"
        width="14"
        height="14"
        rx="0.75"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />

      {/* Squares */}
      <rect x="0" y="0" width="3.5" height="3.5" fill="currentColor"opacity="0.9" />
      <rect x="7" y="0" width="3.5" height="3.5" fill="currentColor" opacity="0.9"/>
      <rect x="3.5" y="3.5" width="3.5" height="3.5" fill="currentColor" opacity="0.9"/>
      <rect x="10.5" y="3.5" width="3.5" height="3.5" fill="currentColor" opacity="0.9" />
      <rect x="0" y="7" width="3.5" height="3.5" fill="currentColor" opacity="0.9" />
      <rect x="7" y="7" width="3.5" height="3.5" fill="currentColor" opacity="0.9" />
      <rect x="3.5" y="10.5" width="3.5" height="3.5" fill="currentColor" opacity="0.9" />
      <rect x="10.5" y="10.5" width="3.5" height="3.5" fill="currentColor" opacity="0.9" />
    </g>

    {/* Paper airplane — smaller, layered on top, white/light color */}
    <g transform="translate(11.6, 10.4) scale(0.12) rotate(20 45 45)">
      {/* Main body */}
      <polygon
        points="38.08,51.92 89,0.99 55.98,89"
        fill="white"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Wing / secondary polygon */}
      <polygon
        points="38.08,51.92 1,34.02 89,0.99"
        fill="white"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Detail / shadow path */}
      <path
        d="M 89.994 0.935 c -0.005 -0.088 -0.022 -0.174 -0.05 -0.258 c -0.011 -0.032 -0.021 -0.063 -0.035 -0.094 c -0.049 -0.107 -0.11 -0.209 -0.196 -0.295 c -0.086 -0.086 -0.188 -0.147 -0.295 -0.196 c -0.032 -0.014 -0.063 -0.024 -0.096 -0.035 c -0.082 -0.028 -0.166 -0.044 -0.252 -0.049 C 89.037 0.005 89.007 -0.001 88.976 0 c -0.108 0.003 -0.217 0.019 -0.322 0.058 L 0.649 33.083 c -0.375 0.141 -0.629 0.491 -0.647 0.891 s 0.204 0.772 0.564 0.946 l 36.769 17.745 l 17.745 36.77 C 55.246 89.781 55.597 90 55.98 90 c 0.015 0 0.03 0 0.045 -0.001 c 0.4 -0.019 0.751 -0.273 0.892 -0.647 L 89.942 1.346 C 89.981 1.24 89.997 1.131 90 1.022 C 90.001 0.992 89.995 0.964 89.994 0.935 z M 85.032 3.553 L 37.879 50.706 L 3.54 34.135 L 85.032 3.553 z M 55.865 86.461 l -16.572 -34.34 L 86.445 4.969 L 55.865 86.461 z"
        fill="rgb(50,49,54)"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  </svg>
);

export default SendToBuddyBoardIcon;


