export function nextFocusIndex(key: string, current: number, count: number): number | undefined {
  if (!count) return;
  switch (key) {
    case 'ArrowRight': return (current + 1) % count;
    case 'ArrowLeft': return (current + count - 1) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
  }
}
