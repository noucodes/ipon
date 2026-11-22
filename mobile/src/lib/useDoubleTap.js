import { useRef } from 'react';

/**
 * Detects a double tap anywhere inside a View without blocking its children.
 * Spread the returned props onto a container View.
 * Ignores long presses and drags (e.g. scrolling) so it only fires on real taps.
 */
export function useDoubleTap(onDoubleTap, { delay = 300, maxMove = 12, maxPress = 250 } = {}) {
  const start = useRef(null);
  const lastTap = useRef(null);

  return {
    onTouchStart: (e) => {
      const { pageX, pageY } = e.nativeEvent;
      start.current = { x: pageX, y: pageY, t: Date.now() };
    },
    onTouchEnd: (e) => {
      const s = start.current;
      if (!s) return;
      const { pageX, pageY } = e.nativeEvent;
      const now = Date.now();
      const isTap = now - s.t < maxPress && Math.abs(pageX - s.x) < maxMove && Math.abs(pageY - s.y) < maxMove;
      if (!isTap) {
        lastTap.current = null;
        return;
      }
      const prev = lastTap.current;
      if (prev && now - prev.t < delay && Math.abs(pageX - prev.x) < 40 && Math.abs(pageY - prev.y) < 40) {
        lastTap.current = null;
        onDoubleTap();
      } else {
        lastTap.current = { x: pageX, y: pageY, t: now };
      }
    },
  };
}
