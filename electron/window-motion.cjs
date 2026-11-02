const animations = new WeakMap();

function secondaryDisplay(displays, primary) {
  return displays.find(display => display.id !== primary.id) || primary;
}

function targetBounds(win, display) {
  const area = display.workArea;
  const bounds = win.getBounds();
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2) };
}

function interpolateBounds(start, end, progress) {
  const eased = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 3);
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(start[key] + (end[key] - start[key]) * eased)]));
}

function animateWindowToSecondaryDisplay(win, widgetBounds, display, { reducedMotion = false } = {}) {
  animations.get(win)?.();
  if (win.isDestroyed()) return Promise.resolve();
  const target = targetBounds(win, display);
  if (reducedMotion) { win.setBounds(target); return Promise.resolve(); }
  const originalMinimum = win.getMinimumSize();
  const start = widgetBounds || win.getBounds();
  // Electron otherwise clamps the initial widget-sized bounds to minWidth/minHeight.
  win.setMinimumSize(1, 1);
  win.setBounds(start);
  return new Promise(resolve => {
    let timer;
    let finished = false;
    const finish = (applyTarget = true) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      animations.delete(win);
      if (!win.isDestroyed()) {
        if (applyTarget) win.setBounds(target);
        win.setMinimumSize(Math.min(originalMinimum[0], display.workArea.width), Math.min(originalMinimum[1], display.workArea.height));
      }
      resolve();
    };
    animations.set(win, () => finish(false));
    const started = Date.now();
    timer = setInterval(() => {
      if (win.isDestroyed()) { finish(false); return; }
      const progress = (Date.now() - started) / 350;
      win.setBounds(interpolateBounds(start, target, progress));
      if (progress >= 1) finish();
    }, 1000 / 60);
  });
}

module.exports = { secondaryDisplay, targetBounds, interpolateBounds, animateWindowToSecondaryDisplay };