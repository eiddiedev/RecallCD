const PALETTE_GROUPS = {
  warm: { title: "日光暖调", spine: "WARM", tags: ["暖色", "旅行", "胶片"] },
  blue: { title: "蓝色旅行", spine: "BLUE", tags: ["冷色", "天空", "远行"] },
  green: { title: "绿意户外", spine: "GREEN", tags: ["植物", "户外", "自然"] },
  night: { title: "夜色霓虹", spine: "NIGHT", tags: ["暗调", "城市", "霓虹"] },
  paper: { title: "纸面截图", spine: "PAPER", tags: ["截图", "文档", "白底"] },
  unknown: { title: "未知记忆", spine: "MIXED", tags: ["混合", "未识别", "待命名"] }
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
  let dark = 0, white = 0, green = 0, blue = 0;
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
    if (lum < .22) dark += 1;
    if (lum > .82 && sat < .22) white += 1;
    if (pg > pr * 1.1 && pg > pb * 1.05) green += 1;
    if (pb > pr * 1.1 && pb > pg * .9) blue += 1;
  }

  r /= n; g /= n; b /= n;
  const dominantColor = rgbToHex(
    Math.round(weightedR / weightSum),
    Math.round(weightedG / weightSum),
    Math.round(weightedB / weightSum)
  );

  let collectionId = "unknown";
  let paletteLabel = "混合色系";
  let sceneLabel = "未知记忆";
  if (white / n > .45) {
    collectionId = "paper"; paletteLabel = "纸面低饱和"; sceneLabel = "截图/文档";
  } else if (dark / n > .44) {
    collectionId = "night"; paletteLabel = "暗调霓虹"; sceneLabel = "夜景/室内";
  } else if (green / n > .24) {
    collectionId = "green"; paletteLabel = "绿色自然"; sceneLabel = "户外/植物";
  } else if (blue / n > .24) {
    collectionId = "blue"; paletteLabel = "蓝色冷调"; sceneLabel = "天空/旅行";
  } else if (r > b && r > g * .82) {
    collectionId = "warm"; paletteLabel = "暖色胶片"; sceneLabel = "日光/人像";
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

  const group = PALETTE_GROUPS[photo.paletteKey] || PALETTE_GROUPS.unknown;
  return {
    key: photo.paletteKey || "unknown",
    title: group.title,
    spine: group.spine,
    tags: group.tags,
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

function parseExif(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint16(0) !== 0xffd8) return {};

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
