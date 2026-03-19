import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';

interface ImageSliderProps {
  before: string;
  after: string;
  className?: string;
}

export function ImageSlider({ before, after, className }: ImageSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const position = ((x - rect.left) / rect.width) * 100;
    setSliderPosition(Math.min(Math.max(position, 0), 100));
  };

  return (
    <div 
      ref={containerRef}
      className={cn("relative w-full h-full overflow-hidden cursor-ew-resize select-none", className)}
      onMouseMove={handleMove}
      onTouchMove={handleMove}
    >
      {/* After Image (Bottom) */}
      <img 
        src={after} 
        alt="After" 
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Before Image (Top, Clipped) */}
      <div 
        className="absolute inset-0 w-full h-full overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
      >
        <img 
          src={before} 
          alt="Before" 
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* Slider Handle */}
      <div 
        className="absolute inset-y-0 w-1 bg-white shadow-xl z-10 pointer-events-none"
        style={{ left: `${sliderPosition}%` }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-2xl flex items-center justify-center">
          <div className="flex gap-1">
            <div className="w-0.5 h-3 bg-zinc-300 rounded-full" />
            <div className="w-0.5 h-3 bg-zinc-300 rounded-full" />
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute bottom-4 left-4 z-20 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-[10px] font-bold text-white uppercase tracking-widest pointer-events-none">
        Original
      </div>
      <div className="absolute bottom-4 right-4 z-20 px-3 py-1 bg-emerald-500/80 backdrop-blur-md rounded-full text-[10px] font-bold text-white uppercase tracking-widest pointer-events-none">
        New Vision
      </div>
    </div>
  );
}
