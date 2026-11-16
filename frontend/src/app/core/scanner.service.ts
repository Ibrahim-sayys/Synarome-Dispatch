import { Injectable } from '@angular/core';

export interface ScannerDevice { id: string; name: string; }

@Injectable({ providedIn: 'root' })
export class ScannerService {
  private readonly base = 'http://127.0.0.1:17653';

  private async request<T>(path: string, data: object): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data), signal: AbortSignal.timeout(190_000),
      });
    } catch {
      throw new Error('Cannot reach the Windows scanner companion. Start it and allow local network access if your browser asks. If you opened the app over HTTP on a network address, your browser may block access; try HTTPS or localhost.');
    }
    if (!response.ok) {
      if (response.status === 403) throw new Error('This website does not match the address saved in the scanner companion.');
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'The scanner could not complete the request.');
    }
    return response.json() as Promise<T>;
  }

  async devices(): Promise<ScannerDevice[]> {
    const response = await this.request<{ devices: ScannerDevice[] }>('devices', {});
    return response.devices;
  }

  async scan(deviceId: string): Promise<File> {
    const response = await this.request<{ data: string }>('scan', { deviceId });
    const binary = atob(response.data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('The scanned page is empty or exceeds 5 MB.');
    return new File([bytes], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
  }
}

/** Package JPEG pages into a PDF without sending the draft to the server. */
export async function scannedPagesToPdf(pages: File[]): Promise<File> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const write = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes); length += bytes.length;
  };
  const object = (id: number, value: string) => { offsets[id] = length; write(`${id} 0 obj\n${value}\nendobj\n`); };
  write('%PDF-1.4\n%PDF\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const bitmap = await createImageBitmap(page);
    const width = bitmap.width, height = bitmap.height;
    bitmap.close();
    const id = 3 + i * 3;
    const data = new Uint8Array(await page.arrayBuffer());
    // Preserve the aspect ratio on an A4 page, with a small margin.
    const scale = Math.min(555 / width, 802 / height);
    const w = width * scale, h = height * scale;
    const content = `q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${((595 - w) / 2).toFixed(2)} ${((842 - h) / 2).toFixed(2)} cm\n/Im0 Do\nQ\n`;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    offsets[id + 1] = length;
    write(`${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`);
    write(data); write('\nendstream\nendobj\n');
    object(id + 2, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  }
  const xref = length;
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let i = 1; i < offsets.length; i++) write(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new File(chunks as BlobPart[], `scan-${Date.now()}.pdf`, { type: 'application/pdf' });
}

export async function scannedPageToPng(page: File): Promise<File> {
  const image = await createImageBitmap(page);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cannot convert the scan to PNG.');
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Cannot convert the scan to PNG.');
    return new File([blob], page.name.replace(/\.jpg$/i, '.png'), { type: 'image/png' });
  } finally { image.close(); }
}
