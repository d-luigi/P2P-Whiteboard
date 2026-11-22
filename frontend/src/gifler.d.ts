declare module 'gifler' {
  export default function gifler(src: string): {
    get(callback: (animator: { animateInCanvas(canvas: HTMLCanvasElement): void; stop(): void }) => void): void;
  };
}
