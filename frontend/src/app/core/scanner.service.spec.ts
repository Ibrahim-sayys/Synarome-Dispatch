import { describe, expect, it } from 'vitest';
import { cropBounds, scanFileName } from './scanner.service';

describe('scanned documents', () => {
  it('names scans with their local date, time and page number', () => {
    const date = new Date(2026, 10, 17, 9, 4, 6, 123);
    expect(scanFileName('jpg', 2, date)).toBe('Scan-2026-11-17_09-04-06-123-page-02.jpg');
    expect(scanFileName('pdf', undefined, date)).toBe('Scan-2026-11-17_09-04-06-123.pdf');
  });

  it('maps crop edge percentages to the full-resolution source image', () => {
    expect(cropBounds(2000, 1000, 10, 15, 20, 5)).toEqual({ x: 200, y: 200, width: 1500, height: 750 });
    expect(cropBounds(101, 99, 0, 0, 0, 0)).toEqual({ x: 0, y: 0, width: 101, height: 99 });
  });
});
