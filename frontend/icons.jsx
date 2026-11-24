import React from 'react';

export const Ic = ({ d, size = 16 }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

export const IcTree = () => (
  <Ic
    size={20}
    d="M12 22V12M12 12C12 12 7 9 7 5a5 5 0 0 1 10 0c0 4-5 7-5 7zM5 22h14"
  />
);

export const IcX = () => <Ic d="M18 6 6 18M6 6l12 12" />;

export const IcTarget = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="22" y1="12" x2="18" y2="12" />
    <line x1="6" y1="12" x2="2" y2="12" />
    <line x1="12" y1="6" x2="12" y2="2" />
    <line x1="12" y1="22" x2="12" y2="18" />
  </svg>
);

export const IcInfo = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export const IcUser = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const IcPlus = () => <Ic d="M12 5v14M5 12h14" />;

export const IcChevs = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width={14}
    height={14}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </svg>
);

export const IcSibling = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width={14}
    height={14}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="9" cy="7" r="3" />
    <circle cx="15" cy="7" r="3" />
    <path d="M3 21v-2a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2" />
  </svg>
);

