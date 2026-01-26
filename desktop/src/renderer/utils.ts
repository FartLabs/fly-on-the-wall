export function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map(val => val.toString().padStart(2, '0'))
    .join(':');
}

export function isScreenSource(source: { id: string; name: string }): boolean {
  const screenPatterns = ['screen', 'desktop', 'monitor', 'entire'];
  const normalizedName = source.name.toLowerCase();
  const normalizedId = source.id.toLowerCase();
  
  return screenPatterns.some(pattern => 
    normalizedName.includes(pattern) || normalizedId.includes(pattern)
  );
};

