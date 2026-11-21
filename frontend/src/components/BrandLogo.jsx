import React from 'react';
import logoUrl from '../assets/logo.png';

// Official BSDK Clubs Logo (User-branded smiling bubble icon)
export function BrandLogo({ size = 34 }) {
  return (
    <img
      src={logoUrl}
      alt="BSDK Clubs"
      width={size}
      height={size}
      style={{
        borderRadius: Math.round(size * 0.22),
        objectFit: 'cover',
        display: 'inline-block',
        verticalAlign: 'middle',
        boxShadow: '0 2px 6px rgba(0,0,0,0.12)'
      }}
    />
  );
}
