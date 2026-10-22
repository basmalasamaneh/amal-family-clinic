import { Unzip, UnzipInflate } from 'fflate';
import { fail } from './common';

const MAX_EXPANDED = 16 * 1024 * 1024;
const MAX_ENTRIES = 512;
/** Check both advertised central-directory sizes and actual streamed expansion.
 * ZIP64, encrypted archives and multi-volume archives are deliberately unsupported. */
export function checkZip(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (view.getUint32(end, true) === 0x06054b50) break;
  if (end < 0 || end < bytes.length - 65557) fail('errZip');
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (count > MAX_ENTRIES) fail('errZipLimit');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count || count === 0 ||
    offset + size !== end || end + 22 + view.getUint16(end + 20, true) !== bytes.length) fail('errZip');
  let pos = offset;
  let total = 0;
  const names = new Map<string, number>();
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) fail('errZip');
    const compressed = view.getUint32(pos + 20, true);
    const expanded = view.getUint32(pos + 24, true);
    const length = view.getUint16(pos + 28, true);
    const next = pos + 46 + length + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    if (next > end || view.getUint16(pos + 8, true) & 1 ||
      ![0, 8].includes(view.getUint16(pos + 10, true)) ||
      compressed > bytes.length || view.getUint32(pos + 42, true) >= offset) fail('errZip');
    total += expanded;
    if (total > MAX_EXPANDED) fail('errZipLimit');
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + length));
    if (names.has(name)) fail('errZip');
    names.set(name, expanded);
    const local = view.getUint32(pos + 42, true);
    if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 6, true) !== view.getUint16(pos + 8, true) ||
      view.getUint16(local + 8, true) !== view.getUint16(pos + 10, true)) fail('errZip');
    const localLength = view.getUint16(local + 26, true);
    const dataStart = local + 30 + localLength + view.getUint16(local + 28, true);
    if (dataStart + compressed > offset || localLength !== length ||
      new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + localLength)) !== name) fail('errZip');
    // Without a data descriptor both directories must agree. With one, local
    // sizes may be zero, but must never request a larger allocation.
    const descriptor = Boolean(view.getUint16(local + 6, true) & 8);
    for (const [localField, expected] of [[18, compressed], [22, expanded]] as const) {
      const value = view.getUint32(local + localField, true);
      if (value !== expected && !(descriptor && value === 0)) fail('errZip');
    }
    ranges.push([local, dataStart + compressed]);
    pos = next;
  }
  if (pos !== end) fail('errZip');
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i]![0] < ranges[i - 1]![1]) fail('errZip');
  let actual = 0;
  let entries = 0;
  let invalid = false;
  const unzip = new Unzip(file => {
    if (++entries > MAX_ENTRIES) fail('errZipLimit');
    let entrySize = 0;
    if (!names.has(file.name)) { invalid = true; return; }
    file.ondata = (error, data, final) => {
      if (error) { invalid = true; return; }
      actual += data.length;
      entrySize += data.length;
      if (final && entrySize !== names.get(file.name)) invalid = true;
      if (actual > MAX_EXPANDED) file.terminate();
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 256) {
    unzip.push(bytes.subarray(i, i + 256), i + 256 >= bytes.length);
    // Never throw inside fflate callbacks: its decoder catches callback exceptions.
    if (actual > MAX_EXPANDED) fail('errZipLimit');
    if (invalid) fail('errZip');
  }
  if (entries !== count || actual !== total) fail('errZip');
}
