export function downloadFile(data: Uint8Array | string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function safeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\.(pdf|xml)$/i, '')
    .replace(/[\/:*?"<>|\u0000-\u001f]+/g, '_')
    .slice(0, 150);
  return cleaned || 'tai-lieu';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
