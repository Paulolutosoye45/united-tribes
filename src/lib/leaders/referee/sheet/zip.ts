import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Just enough of the zip format to open and make a spreadsheet (.xlsx is a zip of small XML files). No other package is needed.
 * It reads only what a spreadsheet program writes: stored or deflated entries, no encryption, no zip64.
 */

export class ZipError extends Error {}

export type ZipEntry = { name: string; data: Buffer };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** A spreadsheet of a few thousand people unpacks to a few megabytes. Anything far larger is not one. */
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_ENTRIES = 2000;

export function readZip(buffer: Buffer): Map<string, Buffer> {
  // The end-of-directory record is within the last 64 KB (it can be followed only by a comment)
  const from = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= from; i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("This isn’t a spreadsheet file we can open.");

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new ZipError("This file has too many parts to be a spreadsheet.");

  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) throw new ZipError("This spreadsheet file is damaged.");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if (flags & 1) throw new ZipError("This spreadsheet is password protected. Remove the password and upload it again.");
    if (size > MAX_ENTRY_BYTES) throw new ZipError("This file is far too large to be a list of people.");
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new ZipError("This file is far too large to be a list of people.");

    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL) throw new ZipError("This spreadsheet file is damaged.");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + compressed);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) {
      try {
        out.set(name, inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }));
      } catch {
        throw new ZipError("This spreadsheet file is damaged.");
      }
    } else throw new ZipError("This spreadsheet uses a compression we can’t read. Save it again as .xlsx or .csv.");
  }
  return out;
}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with every entry deflated. The date is fixed, so the same content always gives the same file. */
export function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const time = 0;
  const date = (1 << 5) | 1 | ((2026 - 1980) << 9); // 1 January 2026
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const deflated = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, deflated);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(CENTRAL, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(deflated.length, 20);
    head.writeUInt32LE(e.data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += local.length + name.length + deflated.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
