import React from 'react';
import { motion } from 'framer-motion';

const ORBS = [
  { w: 520, h: 320, x: 2,  y: 2,  color: '#7c3aed', dur: 14, delay: 0   },
  { w: 380, h: 380, x: 55, y: 40, color: '#4c1d95', dur: 19, delay: 2.5 },
  { w: 430, h: 260, x: 68, y: 5,  color: '#6d28d9', dur: 11, delay: 1   },
  { w: 300, h: 300, x: 25, y: 60, color: '#9b5cf6', dur: 16, delay: 3.5 },
  { w: 250, h: 180, x: 80, y: 70, color: '#5b21b6', dur: 22, delay: 5   },
];

export const AuroraBackground: React.FC = () => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
    {ORBS.map((o, i) => (
      <motion.div
        key={i}
        style={{
          position: 'absolute',
          width: o.w, height: o.h,
          borderRadius: '50%',
          background: `radial-gradient(ellipse, ${o.color}1e 0%, transparent 72%)`,
          filter: 'blur(55px)',
          left: `${o.x}%`,
          top: `${o.y}%`,
        }}
        animate={{
          x: [0, 50, -25, 35, 0],
          y: [0, -35, 25, -20, 0],
          scale: [1, 1.18, 0.88, 1.08, 1],
          opacity: [0.55, 0.9, 0.45, 0.75, 0.55],
        }}
        transition={{ duration: o.dur, repeat: Infinity, ease: 'easeInOut', delay: o.delay }}
      />
    ))}

    {/* Subtle grid overlay */}
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: 'linear-gradient(rgba(155,92,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(155,92,246,0.03) 1px, transparent 1px)',
      backgroundSize: '40px 40px',
    }} />
  </div>
);
