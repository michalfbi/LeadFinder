import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { secondaryDisplay, targetBounds, interpolateBounds, animateWindowToSecondaryDisplay } = require('../../../electron/window-motion.cjs');
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
const external = { id: 2, workArea: { x: -1920, y: 40, width: 1920, height: 1080 } };

describe('Widget display movement', () => {
  it('selects the second display and falls back to primary', () => {
    expect(secondaryDisplay([primary, external], primary).id).toBe(2);
    expect(secondaryDisplay([primary], primary).id).toBe(1);
  });
  it('centres the main window inside the external work area', () => {
    expect(targetBounds({ getBounds: () => ({ width: 1200, height: 860 }) }, external)).toEqual({ x: -1560, y: 150, width: 1200, height: 860 });
  });
  it('uses cubic easing and lands at the exact target', () => {
    const start = { x: 0, y: 0, width: 380, height: 480 }, end = { x: 100, y: 200, width: 1200, height: 860 };
    expect(interpolateBounds(start, end, 0.5)).toEqual({ x: 88, y: 175, width: 1098, height: 813 });
    expect(interpolateBounds(start, end, 1)).toEqual(end);
  });
  it('completes the 350ms animation and restores window minimums', async () => {
    vi.useFakeTimers();
    try {
      const win = { isDestroyed: () => false, getBounds: () => ({ width: 1200, height: 860 }), getMinimumSize: () => [900, 640], setMinimumSize: vi.fn(), setBounds: vi.fn() };
      const motion = animateWindowToSecondaryDisplay(win, { x: 10, y: 10, width: 380, height: 480 }, external);
      await vi.advanceTimersByTimeAsync(370);
      await motion;
      expect(win.setBounds).toHaveBeenLastCalledWith({ x: -1560, y: 150, width: 1200, height: 860 });
      expect(win.setMinimumSize).toHaveBeenLastCalledWith(900, 640);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});