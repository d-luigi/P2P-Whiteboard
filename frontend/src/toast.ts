import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

let nextId = 1;
export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));

export const dismissToast = (id: number) =>
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/** A short message at the bottom of the screen (announced to screen readers). */
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4500) {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  window.setTimeout(() => dismissToast(id), kind === 'error' ? ms * 2 : ms);
}
