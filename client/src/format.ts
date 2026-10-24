const DAY_MS = 86_400_000;

/** "today", "yesterday", "5 days ago" */
export function daysAgo(value: string | Date): string {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export const fileTypeLabel: Record<string, string> = {
  md: 'Reading notes',
  txt: 'Plain text',
  pdf: 'PDF',
  docx: 'Word document',
  pptx: 'Slides',
};
