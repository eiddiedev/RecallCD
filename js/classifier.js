const PALETTE_GROUPS = {
  red: { title: "红色", spine: "RED" },
  orange: { title: "橙色", spine: "ORANGE" },
  yellow: { title: "黄色", spine: "YELLOW" },
  green: { title: "绿色", spine: "GREEN" },
  cyan: { title: "青色", spine: "CYAN" },
  blue: { title: "蓝色", spine: "BLUE" },
  purple: { title: "紫色", spine: "PURPLE" },
  pink: { title: "粉色", spine: "PINK" },
  warm: { title: "暖色", spine: "WARM" },
  night: { title: "暗色", spine: "DARK" },
  paper: { title: "白色", spine: "WHITE" }
};

const CRITERION_LABELS = {
  palette: "色系",
  location: "地点",
  time: "时间"
};

export function getCriterionLabel(criterion) {
  return CRITERION_LABELS[criterion] || CRITERION_LABELS.palette;
}

export function analyzePalette(source) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const c = canvas.getContext("2d", { willReadFrequently: true });
  c.drawImage(source, 0, 0, 64, 64);
  const data = c.getImageData(0, 0, 64, 64).data;
  let r = 0, g = 0, b = 0, n = 0;
  let dark = 0, white = 0;
  let cntRed = 0, cntOrange = 0, cntYellow = 0, cntGreen = 0;
  let cntCyan = 0, cntBlue = 0, cntPurple = 0, cntPink = 0;
  let weightedR = 0, weightedG = 0, weightedB = 0, weightSum = 0;

  for (let i = 0; i < data.length; i += 16) {
    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];
    const lum = (pr * .2126 + pg * .7152 + pb * .0722) / 255;
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    const sat = max === 0 ? 0 : (max - min) / max;
    const weight = 0.35 + sat * 1.4 + Math.abs(lum - 0.5);

    r += pr; g += pg; b += pb; n += 1;
    weightedR += pr * weight; weightedG += pg * weight; weightedB += pb * weight; weightSum += weight;
    if (lum < .22) { dark += 1; continue; }
    if (lum > .82 && sat < .22) { white += 1; continue; }

    const diff = max - min;
    if (pg > pr * 1.1 && pg > pb * 1.05) { cntGreen += 1; continue; }
    if (pb > pr * 1.1 && pb > pg * .92) { cntBlue += 1; continue; }
    if (diff > 30) {
      if (pr > pg * 1.3 && pg > pb * 1.1) { cntOrange += 1; continue; }
      if (pr > pb * 1.2 && pg > pb * 1.1) { cntYellow += 1; continue; }
    }
    if (pr > pg * 1.25 && pr > pb * 1.2) { cntRed += 1; continue; }
    if (pb > pr * 1.1 && pb > pg * 1.05 && pg > pr * .85) { cntPurple += 1; continue; }
    if (pr > pg * 1.1 && pb > pg * .95) { cntPink += 1; continue; }
    if (pg > pr * .92 && pb > pr * 1.05) { cntCyan += 1; continue; }
  }

  r /= n; g /= n; b /= n;
  const dominantColor = rgbToHex(
    Math.round(weightedR / weightSum),
    Math.round(weightedG / weightSum),
    Math.round(weightedB / weightSum)
  );

  const colorCounts = [
    ["green", cntGreen], ["blue", cntBlue], ["red", cntRed], ["orange", cntOrange],
    ["yellow", cntYellow], ["purple", cntPurple], ["pink", cntPink], ["cyan", cntCyan]
  ];
  colorCounts.sort((a, b) => b[1] - a[1]);

  let collectionId = "warm";
  let paletteLabel = "暖色";
  let sceneLabel = "";
  if (white / n > .45) {
    collectionId = "paper"; paletteLabel = "白色";
  } else if (dark / n > .44) {
    collectionId = "night"; paletteLabel = "暗色";
  } else if (colorCounts[0][1] / n > .2) {
    collectionId = colorCounts[0][0];
    paletteLabel = PALETTE_GROUPS[collectionId].title;
  }

  return {
    collectionId,
    paletteLabel,
    sceneLabel,
    dominantColor,
    palette: makeAdaptivePalette(dominantColor)
  };
}

export async function parsePhotoMetadata(file) {
  const fallbackDate = file?.lastModified ? new Date(file.lastModified) : null;
  const fallback = {
    timeLabel: fallbackDate ? `文件 ${formatDate(fallbackDate)}` : "未知时间",
    timeKey: fallbackDate ? formatMonth(fallbackDate) : "unknown-time",
    timeSource: fallbackDate ? "file" : "unknown",
    locationLabel: "未知地点",
    locationKey: "unknown-location",
    locationSource: "unknown",
    deviceLabel: "未知设备",
    deviceKey: "unknown-device",
    gps: null
  };

  if (!file || !file.arrayBuffer) return fallback;

  try {
    const buffer = await file.arrayBuffer();
    const exif = parseExif(buffer);
    const takenAt = parseExifDate(exif.dateTimeOriginal || exif.dateTime);
    if (takenAt) {
      fallback.timeLabel = `拍摄 ${formatDateTime(takenAt)}`;
      fallback.timeKey = formatMonth(takenAt);
      fallback.timeSource = "exif";
    }
    if (exif.gps) {
      const mapped = mapGpsToRegion(exif.gps.lat, exif.gps.lon);
      fallback.locationLabel = mapped.label;
      fallback.locationKey = mapped.key;
      fallback.locationSource = "gps";
      fallback.gps = exif.gps;
    }
    const device = formatDevice(exif.make, exif.model);
    if (device) {
      fallback.deviceLabel = device;
      fallback.deviceKey = slugify(device);
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function classifyPhoto(photo, criterion) {
  const manual = photo.manualGroupByCriterion?.[criterion];
  if (manual) {
    return {
      key: manual.key,
      title: manual.title,
      spine: manual.spine || toSpine(manual.title),
      tags: [getCriterionLabel(criterion), "手动"],
      sortValue: manual.title,
      criterion
    };
  }

  if (criterion === "location") {
    const title = photo.locationLabel || "未知地点";
    return {
      key: photo.locationKey || "unknown-location",
      title,
      spine: toSpine(title),
      tags: ["地点", photo.locationSource === "gps" ? "GPS" : "未读取"],
      sortValue: title === "未知地点" ? "zzzz" : title,
      criterion
    };
  }

  if (criterion === "time") {
    const title = photo.timeKey === "unknown-time" ? "未知时间" : photo.timeKey;
    return {
      key: photo.timeKey || "unknown-time",
      title,
      spine: title,
      tags: ["时间", photo.timeSource === "exif" ? "拍摄时间" : "文件时间"],
      sortValue: photo.timeKey === "unknown-time" ? "0000.00" : photo.timeKey,
      criterion
    };
  }

  const group = PALETTE_GROUPS[photo.paletteKey] || PALETTE_GROUPS.warm;
  return {
    key: photo.paletteKey || "warm",
    title: group.title,
    spine: group.spine,
    tags: [],
    sortValue: Object.keys(PALETTE_GROUPS).indexOf(photo.paletteKey),
    criterion: "palette"
  };
}

export function makeAdaptivePalette(hex) {
  const rgb = hexToRgb(hex || "#8a6a55");
  const lifted = liftForDarkBackground(rgb);
  const primary = rgbToHex(lifted.r, lifted.g, lifted.b);
  const secondary = rgbToHex(
    Math.round(lifted.r * 0.22),
    Math.round(lifted.g * 0.2),
    Math.round(lifted.b * 0.2)
  );
  const lum = (lifted.r * .2126 + lifted.g * .7152 + lifted.b * .0722) / 255;
  const text = lum > .54 ? "#18120d" : "#fff1de";
  return { primary, secondary, text };
}

function liftForDarkBackground(rgb) {
  const lum = (rgb.r * .2126 + rgb.g * .7152 + rgb.b * .0722) / 255;
  if (lum >= .22) return rgb;
  const amount = (.22 - lum) / .22 * 82;
  return {
    r: clamp(Math.round(rgb.r + amount), 0, 255),
    g: clamp(Math.round(rgb.g + amount), 0, 255),
    b: clamp(Math.round(rgb.b + amount), 0, 255)
  };
}

export function formatDate(msOrDate) {
  const d = msOrDate instanceof Date ? msOrDate : new Date(msOrDate);
  if (Number.isNaN(d.getTime())) return "未知时间";
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function formatDateTime(date) {
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMonth(date) {
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}`;
}

function findBox(view, start, end, type) {
  let off = start;
  while (off + 8 <= end) {
    const size = view.getUint32(off, false);
    if (size < 8 || off + size > end) break;
    if (readAscii(view, off + 4, 4) === type) return { offset: off, size };
    off += size;
  }
  return null;
}

function parseHeicExif(view) {
  const len = view.byteLength;
  if (len < 12 || readAscii(view, 4, 4) !== "ftyp") return {};
  const meta = findBox(view, 0, len, "meta");
  if (!meta) return {};
  const mStart = meta.offset + 12;
  const mEnd = meta.offset + meta.size;
  const hdlr = findBox(view, mStart, mEnd, "hdlr");
  if (!hdlr || readAscii(view, hdlr.offset + 16, 4) !== "pict") return {};
  const pitm = findBox(view, mStart, mEnd, "pitm");
  if (!pitm) return {};
  const pitmVer = view.getUint8(pitm.offset + 8);
  const primaryId = pitmVer === 0
    ? view.getUint16(pitm.offset + 12, false)
    : view.getUint32(pitm.offset + 12, false);
  const iinf = findBox(view, mStart, mEnd, "iinf");
  if (iinf) {
    const iinfVer = view.getUint8(iinf.offset + 8);
    const entryCount = iinfVer === 0
      ? view.getUint16(iinf.offset + 12, false)
      : view.getUint32(iinf.offset + 12, false);
    let pos = iinf.offset + (iinfVer === 0 ? 14 : 16);
    for (let i = 0; i < entryCount && pos + 8 <= iinf.offset + iinf.size; i++) {
      const boxSize = view.getUint32(pos, false);
      if (boxSize < 8) break;
      const boxType = readAscii(view, pos + 4, 4);
      if (boxType === "infe") {
        const infeVer = view.getUint8(pos + 8);
        const iid = infeVer >= 2
          ? view.getUint32(pos + 12, false)
          : view.getUint16(pos + 12, false);
        if (iid === primaryId && infeVer >= 2 && readAscii(view, pos + 18, 4) === "Exif") {
          const iloc = findBox(view, mStart, mEnd, "iloc");
          if (iloc) {
            const ilocVer = view.getUint8(iloc.offset + 8);
            const sizes = view.getUint16(iloc.offset + 12, false);
            const offsetBits = (sizes >> 12) & 0xf;
            const lengthBits = (sizes >> 8) & 0xf;
            const baseBits = (sizes >> 4) & 0xf;
            const indexBits = sizes & 0xf;
            const idBytes = ilocVer < 2 ? 2 : 4;
            let cur = iloc.offset + 14;
            const count = ilocVer < 2
              ? view.getUint16(cur, false)
              : view.getUint32(cur, false);
            cur += ilocVer < 2 ? 2 : 4;
            for (let j = 0; j < count && cur + idBytes + 2 <= iloc.offset + iloc.size; j++) {
              const itemId = ilocVer < 2
                ? view.getUint16(cur, false)
                : view.getUint32(cur, false);
              cur += idBytes;
              if (ilocVer === 1 || ilocVer === 2) cur += 2;
              cur += 2;
              const bOff = baseBits === 4 ? view.getUint32(cur, false) : baseBits === 2 ? view.getUint16(cur, false) : 0;
              cur += baseBits === 0 ? 0 : baseBits === 2 ? 2 : baseBits === 4 ? 4 : baseBits === 8 ? 8 : 0;
              const extentCount = view.getUint16(cur, false);
              cur += 2;
              for (let k = 0; k < extentCount; k++) {
                if (indexBits === 8) cur += 8;
                else if (indexBits === 4) cur += 4;
                const extOff = offsetBits === 8
                  ? Number(view.getBigUint64(cur, false))
                  : offsetBits === 4 ? view.getUint32(cur, false) : offsetBits === 2 ? view.getUint16(cur, false) : 0;
                cur += offsetBits === 0 ? 0 : offsetBits === 2 ? 2 : offsetBits === 4 ? 4 : offsetBits === 8 ? 8 : 0;
                const extLen = lengthBits === 8
                  ? Number(view.getBigUint64(cur, false))
                  : lengthBits === 4 ? view.getUint32(cur, false) : lengthBits === 2 ? view.getUint16(cur, false) : 0;
                cur += lengthBits === 0 ? 0 : lengthBits === 2 ? 2 : lengthBits === 4 ? 4 : lengthBits === 8 ? 8 : 0;
                if (itemId === iid) {
                  const absOff = bOff + extOff;
                  const absEnd = absOff + extLen;
                  if (absEnd <= len && extLen >= 8) {
                    for (let s = absOff; s + 2 < absEnd; s++) {
                      const b0 = view.getUint8(s);
                      const b1 = view.getUint8(s + 1);
                      if ((b0 === 0x49 && b1 === 0x49) || (b0 === 0x4D && b1 === 0x4D)) {
                        if (view.getUint16(s + 2, b0 === 0x49) === 42) {
                          return readTiff(view, s, absEnd);
                        }
                      }
                    }
                  }
                  return {};
                }
              }
            }
          }
        }
      }
      pos += boxSize;
    }
  }
  return {};
}

function parseWebpExif(view) {
  const len = view.byteLength;
  if (len < 12 || readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WEBP") return {};
  let off = 12;
  while (off + 8 <= len) {
    const chunkId = readAscii(view, off, 4);
    const chunkSize = view.getUint32(off + 4, true);
    if (chunkId === "EXIF" && chunkSize >= 8 && off + 8 + chunkSize <= len) {
      const dataStart = off + 8;
      const dataEnd = dataStart + chunkSize;
      for (let s = dataStart; s + 2 < dataEnd; s++) {
        const b0 = view.getUint8(s);
        const b1 = view.getUint8(s + 1);
        if ((b0 === 0x49 && b1 === 0x49) || (b0 === 0x4D && b1 === 0x4D)) {
          if (dataEnd - s >= 8 && view.getUint16(s + 2, b0 === 0x49) === 42) {
            return readTiff(view, s, dataEnd);
          }
        }
      }
      return {};
    }
    off += 8 + chunkSize + (chunkSize & 1);
  }
  return {};
}

function parseExif(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12) return {};
  if (view.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2, false);
      if (marker === 0xe1 && offset + 10 < view.byteLength && readAscii(view, offset + 4, 6) === "Exif\0\0") {
        return readTiff(view, offset + 10, offset + 2 + size);
      }
      offset += 2 + size;
    }
    return {};
  }
  if (readAscii(view, 4, 4) === "ftyp") return parseHeicExif(view);
  if (readAscii(view, 0, 4) === "RIFF" && readAscii(view, 8, 4) === "WEBP") return parseWebpExif(view);
  return {};
}

function readTiff(view, start, end) {
  const little = readAscii(view, start, 2) === "II";
  const magic = view.getUint16(start + 2, little);
  if (magic !== 42) return {};
  const firstIfd = start + view.getUint32(start + 4, little);
  const ifd0 = readIfd(view, start, firstIfd, little, end);
  const exifIfd = ifd0[0x8769] ? readIfd(view, start, start + ifd0[0x8769], little, end) : {};
  const gpsIfd = ifd0[0x8825] ? readIfd(view, start, start + ifd0[0x8825], little, end) : {};
  return {
    dateTime: ifd0[0x0132],
    make: ifd0[0x010f],
    model: ifd0[0x0110],
    dateTimeOriginal: exifIfd[0x9003] || exifIfd[0x9004],
    gps: parseGps(gpsIfd)
  };
}

function readIfd(view, tiffStart, offset, little, end) {
  if (offset < tiffStart || offset + 2 > end) return {};
  const count = view.getUint16(offset, little);
  const values = {};
  for (let i = 0; i < count; i += 1) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > end) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const size = view.getUint32(entry + 4, little);
    const valueOffset = entry + 8;
    values[tag] = readExifValue(view, tiffStart, valueOffset, type, size, little, end);
  }
  return values;
}

function readExifValue(view, tiffStart, valueOffset, type, count, little, end) {
  const byteSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type] || 1;
  const total = byteSize * count;
  const offset = total <= 4 ? valueOffset : tiffStart + view.getUint32(valueOffset, little);
  if (offset < 0 || offset + total > end) return null;

  if (type === 2) return readAscii(view, offset, count).replace(/\0+$/, "");
  if (type === 3) return count === 1 ? view.getUint16(offset, little) : Array.from({ length: count }, (_, i) => view.getUint16(offset + i * 2, little));
  if (type === 4) return count === 1 ? view.getUint32(offset, little) : Array.from({ length: count }, (_, i) => view.getUint32(offset + i * 4, little));
  if (type === 5) {
    const readRat = (pos) => {
      const num = view.getUint32(pos, little);
      const den = view.getUint32(pos + 4, little) || 1;
      return num / den;
    };
    return count === 1 ? readRat(offset) : Array.from({ length: count }, (_, i) => readRat(offset + i * 8));
  }
  return null;
}

function parseGps(gpsIfd) {
  const lat = gpsToDecimal(gpsIfd[0x0002], gpsIfd[0x0001]);
  const lon = gpsToDecimal(gpsIfd[0x0004], gpsIfd[0x0003]);
  if (lat == null || lon == null) return null;
  return { lat, lon };
}

function gpsToDecimal(parts, ref) {
  if (!Array.isArray(parts) || parts.length < 3) return null;
  const value = parts[0] + parts[1] / 60 + parts[2] / 3600;
  return ref === "S" || ref === "W" ? -value : value;
}

function mapGpsToRegion(lat, lon) {
  const china = [
    ["广东", "guangdong", 20, 25.7, 109, 117.4],
    ["上海", "shanghai", 30.6, 31.9, 120.8, 122.2],
    ["北京", "beijing", 39.4, 41.1, 115.4, 117.6],
    ["四川", "sichuan", 26, 34.5, 97, 108.8],
    ["浙江", "zhejiang", 27, 31.5, 118, 123],
    ["江苏", "jiangsu", 30.7, 35.3, 116.3, 122.2],
    ["云南", "yunnan", 21, 29.5, 97, 106.5],
    ["福建", "fujian", 23.3, 28.6, 115.5, 120.8],
    ["山东", "shandong", 34.3, 38.4, 114.8, 122.8],
    ["陕西", "shaanxi", 31.6, 39.6, 105.3, 111.5]
  ];
  for (const [label, key, minLat, maxLat, minLon, maxLon] of china) {
    if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) return { label, key: `loc-cn-${key}` };
  }
  if (lat >= 18 && lat <= 54 && lon >= 73 && lon <= 135) return { label: "中国", key: "loc-country-china" };

  const countries = [
    ["Japan", "japan", 24, 46, 122, 146],
    ["Indonesia", "indonesia", -11, 6.5, 95, 142],
    ["USA", "usa", 24, 50, -125, -66],
    ["France", "france", 41, 51.5, -5.5, 9.8],
    ["United Kingdom", "uk", 49.5, 59, -8.5, 2.2],
    ["Thailand", "thailand", 5, 21, 97, 106],
    ["Singapore", "singapore", 1.1, 1.55, 103.5, 104.1],
    ["Korea", "korea", 33, 39.5, 124, 132]
  ];
  for (const [label, key, minLat, maxLat, minLon, maxLon] of countries) {
    if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) return { label, key: `loc-country-${key}` };
  }
  return { label: "未知地点", key: "unknown-location" };
}

function parseExifDate(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function readAscii(view, offset, length) {
  let text = "";
  for (let i = 0; i < length && offset + i < view.byteLength; i += 1) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
}

function toSpine(value) {
  const text = String(value || "MEMORY").trim();
  return /^[\x00-\x7F]+$/.test(text) ? text.toUpperCase() : text;
}

function formatDevice(make, model) {
  const maker = String(make || "").trim();
  const rawModel = String(model || "").trim();
  const value = rawModel || maker;
  if (!value) return "";
  if (/iphone/i.test(value)) return value.replace(/\s+/g, "");
  if (maker && rawModel && !rawModel.toLowerCase().includes(maker.toLowerCase())) return `${maker} ${rawModel}`.trim();
  return value;
}

function slugify(value) {
  return encodeURIComponent(value.trim().toLowerCase()).replace(/%/g, "").slice(0, 28);
}

function hexToRgb(hex) {
  const clean = String(hex || "#8a6a55").replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pad(value) {
  return String(value).padStart(2, "0");
}
