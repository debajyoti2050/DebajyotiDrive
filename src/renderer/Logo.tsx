import React from 'react';
import { motion } from 'framer-motion';

export const Logo: React.FC<{ size?: number }> = ({ size = 30 }) => (
  <motion.div
    animate={{ filter: ['drop-shadow(0 0 4px rgba(155,92,246,0.4))', 'drop-shadow(0 0 14px rgba(155,92,246,0.85))', 'drop-shadow(0 0 4px rgba(155,92,246,0.4))'] }}
    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    style={{ display: 'flex', alignItems: 'center' }}
  >
  <svg width={size} height={size} viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="logoBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#7c3aed" />
        <stop offset="100%" stopColor="#4c1d95" />
      </linearGradient>
      <linearGradient id="logoCloud" x1="0.5" y1="0" x2="0.5" y2="1">
        <stop offset="0%" stopColor="#f5f3ff" />
        <stop offset="100%" stopColor="#ddd6fe" />
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    {/* Background */}
    <rect width="34" height="34" rx="9" fill="url(#logoBg)" />

    {/* Subtle inner glow ring */}
    <rect width="34" height="34" rx="9" fill="none" stroke="rgba(196,181,253,0.2)" strokeWidth="1" />

    {/* Cloud body */}
    <path
      d="M8.5 22a5 5 0 0 1 .6-9.9 7 7 0 0 1 13.5 2A3.8 3.8 0 1 1 22.5 22H8.5z"
      fill="url(#logoCloud)"
      filter="url(#glow)"
    />

    {/* Arrow shaft */}
    <path d="M17 27v-7.5" stroke="#9333ea" strokeWidth="2.2" strokeLinecap="round" />
    {/* Arrow head */}
    <path d="M13.5 22l3.5-4 3.5 4" stroke="#9333ea" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

    {/* S3 badge — bottom right */}
    <rect x="22" y="24" width="10" height="8" rx="2.5" fill="#6d28d9" />
    <text x="27" y="30.5" textAnchor="middle" fill="#e9d5ff" fontSize="5.5" fontWeight="700" fontFamily="ui-monospace,monospace">S3</text>
  </svg>
  </motion.div>
);
