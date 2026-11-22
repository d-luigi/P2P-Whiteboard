import { useEffect } from 'react';
import { create } from 'zustand';
import { boardCode, isMarkedDeleted } from './board';

const env = import.meta.env as Record<string, string | undefined>;
const fallback = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:4444`;
// Every client uses the first configured signaling server as the room-code directory.
const endpoint = (env.VITE_SIGNALING ?? fallback).split(',').map((url) => url.trim()).filter(Boolean)[0];
const useCodeState = create<{ code: string; error: string }>(() => ({ code: '', error: '' }));

export function requestRoomCode(type: 'room-register' | 'room-resolve', value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const id = crypto.randomUUID();
    const finish = (result?: string, error?: string) => {
      clearTimeout(timer);
      socket.onclose = null;
      socket.close();
      if (result) resolve(result);
      else reject(new Error(error || 'Room-code server is unavailable. Try again shortly.'));
    };
    const timer = window.setTimeout(() => finish(undefined, 'Room-code server did not respond. It may need the latest server update.'), 15000);
    socket.onopen = () => socket.send(JSON.stringify({ type, id, ...(type === 'room-register' ? { fragment: value } : { code: value }) }));
    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type !== 'room-result' || message.id !== id) return;
      finish(type === 'room-register' ? message.code : message.fragment, message.error);
    };
    socket.onerror = () => finish();
    socket.onclose = () => finish();
  });
}

let subscribers = 0;
let refreshTimer: number | undefined;
let generation = 0;
async function refresh(current: number) {
  if (isMarkedDeleted()) return;
  try {
    const code = await requestRoomCode('room-register', boardCode);
    if (current === generation) useCodeState.setState({ code, error: '' });
  } catch (error) {
    if (current === generation) useCodeState.setState({ code: '', error: error instanceof Error ? error.message : 'Code unavailable' });
  }
}

export function useRoomCode() {
  const state = useCodeState();
  useEffect(() => {
    if (++subscribers === 1) {
      const current = ++generation;
      void refresh(current);
      refreshTimer = window.setInterval(() => void refresh(current), 30000);
    }
    return () => {
      if (--subscribers === 0) { clearInterval(refreshTimer); generation++; }
    };
  }, []);
  return state;
}
