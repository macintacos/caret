// A minimal zip writer (EXC-1188), for the one archive caret produces: `caret doctor
// --bundle`. caret ships no zip library and Bun has no zip API, so the container is
// written directly — one local header, one central-directory record and one end-of-
// central-directory record, per APPNOTE 6.3, with deflate via Bun and CRC-32 via
// node:zlib. No zip64, no data descriptors, no encryption: a diagnostics bundle is a
// handful of files well under 4 GiB.
//
// Spawning the system `zip` was the alternative and was rejected twice over: `zip` is
// absent from minimal Linux images, and a child process cannot create the file 0600
// without a umask dance, whereas openSync(path, "wx", 0o600) is owner-only from the
// moment the inode exists — no world-readable window, and an existing path is a refusal
// rather than an overwrite.

import { closeSync, openSync, writeSync } from "node:fs";
import { crc32 } from "node:zlib";

/** One file in the archive: the path it is stored under, and its bytes. The buffer is
 * narrowed to a plain ArrayBuffer because Bun's deflate does not take a shared one. */
export interface ZipEntry {
  name: string;
  data: Uint8Array<ArrayBuffer>;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** "2.0" — the version that introduced deflate, which is all this writer emits. */
const VERSION = 20;
const DEFLATE = 8;

/** MS-DOS time and date, the only timestamp the base format carries: seconds in 2-second
 * units, and a year counted from 1980. Read in UTC so an archive's stamp does not depend
 * on the machine that wrote it. */
function dosStamp(now: Date): { time: number; date: number } {
  return {
    time: (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | (now.getUTCSeconds() >> 1),
    date: ((now.getUTCFullYear() - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate(),
  };
}

/** What both headers say about one entry, computed once so they cannot disagree. */
interface Record {
  name: Uint8Array;
  body: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

function localHeader(r: Record, stamp: { time: number; date: number }): Uint8Array {
  const head = new DataView(new ArrayBuffer(30));
  head.setUint32(0, LOCAL_SIG, true);
  head.setUint16(4, VERSION, true);
  head.setUint16(6, 0, true); // general-purpose flags
  head.setUint16(8, DEFLATE, true);
  head.setUint16(10, stamp.time, true);
  head.setUint16(12, stamp.date, true);
  head.setUint32(14, r.crc, true);
  head.setUint32(18, r.body.length, true);
  head.setUint32(22, r.size, true);
  head.setUint16(26, r.name.length, true);
  head.setUint16(28, 0, true); // extra-field length
  return new Uint8Array(head.buffer);
}

function centralHeader(r: Record, stamp: { time: number; date: number }): Uint8Array {
  const head = new DataView(new ArrayBuffer(46));
  head.setUint32(0, CENTRAL_SIG, true);
  head.setUint16(4, VERSION, true); // version made by
  head.setUint16(6, VERSION, true); // version needed
  head.setUint16(8, 0, true); // general-purpose flags
  head.setUint16(10, DEFLATE, true);
  head.setUint16(12, stamp.time, true);
  head.setUint16(14, stamp.date, true);
  head.setUint32(16, r.crc, true);
  head.setUint32(20, r.body.length, true);
  head.setUint32(24, r.size, true);
  head.setUint16(28, r.name.length, true);
  head.setUint16(30, 0, true); // extra-field length
  head.setUint16(32, 0, true); // comment length
  head.setUint16(34, 0, true); // disk number
  head.setUint16(36, 0, true); // internal attributes
  head.setUint32(38, 0, true); // external attributes
  head.setUint32(42, r.offset, true);
  return new Uint8Array(head.buffer);
}

function eocd(count: number, size: number, offset: number): Uint8Array {
  const head = new DataView(new ArrayBuffer(22));
  head.setUint32(0, EOCD_SIG, true);
  head.setUint16(4, 0, true); // this disk
  head.setUint16(6, 0, true); // disk holding the central directory
  head.setUint16(8, count, true);
  head.setUint16(10, count, true);
  head.setUint32(12, size, true);
  head.setUint32(16, offset, true);
  head.setUint16(20, 0, true); // comment length
  return new Uint8Array(head.buffer);
}

/**
 * Write `entries` to `path` as a deflated zip archive, owner-readable only.
 *
 * Throws if `path` already exists, or on any write failure — the caller decides what an
 * unwritable bundle means.
 */
export function writeZip(path: string, entries: readonly ZipEntry[], now: Date): void {
  const stamp = dosStamp(now);
  const encoder = new TextEncoder();
  const fd = openSync(path, "wx", 0o600);
  try {
    const records: Record[] = [];
    let offset = 0;
    const put = (bytes: Uint8Array) => {
      writeSync(fd, bytes);
      offset += bytes.length;
    };
    for (const entry of entries) {
      const record: Record = {
        name: encoder.encode(entry.name),
        body: Bun.deflateSync(entry.data, { windowBits: -15 }),
        crc: crc32(entry.data),
        size: entry.data.length,
        offset,
      };
      records.push(record);
      put(localHeader(record, stamp));
      put(record.name);
      put(record.body);
    }
    const directoryStart = offset;
    for (const record of records) {
      put(centralHeader(record, stamp));
      put(record.name);
    }
    put(eocd(records.length, offset - directoryStart, directoryStart));
  } finally {
    closeSync(fd);
  }
}
