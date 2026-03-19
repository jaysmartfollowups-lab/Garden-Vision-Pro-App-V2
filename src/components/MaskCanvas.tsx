import React, { useRef, useEffect, useState } from 'react';
import { cn } from '../lib/utils';

interface MaskCanvasProps {
  imageUrl: string;
  onSaveMask: (maskBase64: string) => void;
  className?: string;
}

export function MaskCanvas({ imageUrl, onSaveMask, className }: MaskCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(30);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      // We don't draw the image on the canvas anymore, 
      // we'll use it as a background in the CSS
    };
  }, [imageUrl]);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    draw(e);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      // Create a separate mask canvas to export
      // The mask should be WHITE on BLACK
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const maskCtx = maskCanvas.getContext('2d');
      if (maskCtx) {
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        
        // Draw the strokes as white
        maskCtx.globalCompositeOperation = 'source-over';
        maskCtx.drawImage(canvas, 0, 0);
        
        onSaveMask(maskCanvas.toDataURL('image/png'));
      }
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let x, y;
    if ('touches' in e) {
      x = (e.touches[0].clientX - rect.left) * scaleX;
      y = (e.touches[0].clientY - rect.top) * scaleY;
    } else {
      x = (e.clientX - rect.left) * scaleX;
      y = (e.clientY - rect.top) * scaleY;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'white'; // Mask content is white
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();
  };

  const clearMask = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      onSaveMask('');
    }
  };

  return (
    <div className={cn("relative overflow-hidden cursor-crosshair bg-zinc-900", className)}>
      <img 
        src={imageUrl} 
        alt="Background" 
        className="absolute inset-0 w-full h-full object-cover opacity-50"
      />
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        className="relative z-10 w-full h-full mix-blend-screen opacity-70"
      />
      <div className="absolute bottom-4 left-4 z-20 bg-white/90 backdrop-blur-md p-3 rounded-2xl shadow-2xl flex items-center gap-6">
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Brush Size</label>
          <input 
            type="range" 
            min="5" 
            max="100" 
            value={brushSize} 
            onChange={(e) => setBrushSize(parseInt(e.target.value))}
            className="w-24 accent-emerald-500"
          />
        </div>
        <button 
          onClick={clearMask}
          className="text-[10px] font-bold uppercase tracking-widest text-red-500 hover:text-red-600"
        >
          Clear Mask
        </button>
      </div>
    </div>
  );
}
