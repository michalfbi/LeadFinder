export function widgetBridge() {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { leadfinder?: { widget?: {
    show?: () => Promise<void>;
    openMain?: () => Promise<void>;
  } } }).leadfinder?.widget;
}

export async function openDesktopWidget() {
  const bridge = widgetBridge();
  if (bridge?.show) return bridge.show();
  window.open('/widget', 'leadfinder-widget', 'width=380,height=520');
}