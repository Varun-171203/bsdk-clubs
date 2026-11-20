import React from 'react';

// Section 10 Branding: Original "B" letterform + speech bubble cut,
// solid WhatsApp-style green (#128C7E) with white B — no gradients, no neon.
export function BrandLogo({ size = 34 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="BSDK Clubs logo"
    >
      <path
        d="M8 14C8 8.47715 12.4772 4 18 4H46C51.5228 4 56 8.47715 56 14V42C56 47.5228 51.5228 52 46 52H22L8 60V14Z"
        fill="#128C7E"
      />
      <path
        d="M21 15H34.5C40.2 15 43.5 17.8 43.5 22.1C43.5 25.1 41.8 27.1 39.2 28C42.5 28.9 44.5 31.3 44.5 34.7C44.5 39.6 40.7 42.5 34.5 42.5H21V15ZM27.2 25.8H33.4C35.8 25.8 37.2 24.7 37.2 22.8C37.2 20.9 35.8 19.9 33.4 19.9H27.2V25.8ZM27.2 37.5H34C36.7 37.5 38.2 36.3 38.2 34.1C38.2 31.9 36.6 30.8 33.9 30.8H27.2V37.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
