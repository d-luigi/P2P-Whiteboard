import { useEffect, useRef, useState } from 'react';
import { Image as CanvasImage } from 'react-konva';
import type Konva from 'konva';
import 'gifler';

// The browser bundle publishes its factory on window rather than an ES module export.
const gifler = (src: string) => (window as unknown as { gifler: typeof import('gifler').default }).gifler(src);

export default function MediaContent({ src, width, height }: { src: string; width: number; height: number }) {
  const [image, setImage] = useState<HTMLImageElement | HTMLCanvasElement>();
  const node = useRef<Konva.Image>(null);
  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let stop: (() => void) | undefined;
    setImage(undefined);
    if (src.startsWith('data:image/gif;')) {
      const canvas = document.createElement('canvas');
      gifler(src).get((animator) => {
        if (disposed) { animator.stop(); return; }
        animator.animateInCanvas(canvas);
        stop = () => animator.stop();
        setImage(canvas);
        const draw = () => { node.current?.getLayer()?.batchDraw(); frame = requestAnimationFrame(draw); };
        draw();
      });
    } else {
      const img = new window.Image();
      img.onload = () => { if (!disposed) setImage(img); };
      img.src = src;
    }
    return () => { disposed = true; stop?.(); cancelAnimationFrame(frame); };
  }, [src]);
  return <CanvasImage ref={node} image={image} width={width} height={height} listening={false} />;
}
