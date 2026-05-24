import * as THREE from "./three.module.min.js";
import {
  classifyPhoto,
  makeAdaptivePalette
} from "./classifier.js";

const ERROR_TEXT = "哎呀，出错了，请重启试试吧~";
const STORAGE_KEY = "recallcd.userLibrary.v1";
const DB_NAME = "recallcd-library";
const DB_STORE = "library";
const sceneCanvas = document.getElementById("scene");
const detail = document.getElementById("detail");
const detailCanvas = document.getElementById("detailCanvas");
const backBtn = document.getElementById("backBtn");
const errorEl = document.getElementById("error");
const fmBtn = document.getElementById("fmBtn");
const captionTitle = document.getElementById("captionTitle");
const captionMeta = document.getElementById("captionMeta");
const albumTitleLayer = document.getElementById("albumTitleLayer");
const photoDrawer = document.getElementById("photoDrawer");
const drawerTitle = document.getElementById("drawerTitle");
const drawerMeta = document.getElementById("drawerMeta");
const drawerGrid = document.getElementById("drawerGrid");
const vinylStage = document.getElementById("vinylStage");
const vinylCtx = vinylStage ? vinylStage.getContext("2d") : null;

let collections = [];
let allPhotos = [];

const app = {
  renderer: null,
  scene: null,
  camera: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  groups: [],
  titlePlane: null,
  titlePlaneTitle: "",
  shelfPosition: 0,
  targetPosition: 0,
  spin: 0,
  spinTarget: 0,
  flippedId: null,
  selectedIndex: 0,
  frame: 0,
  drag: null,
  detailCollection: 0,
  detailPhoto: 0,
  drawerPhoto: 0,
  currentCriterion: "palette",
  drawerIndex: -1,
  selectedPhotos: new Set(),
  detailCtx: detailCanvas.getContext("2d"),
  presentationPhase: "idle",
  presentationTimer: 0,
  presentationTimeout: 0,
  lastTickTime: 0
};

const VS_HIDDEN = "hidden";
const VS_SLIDEUP = "slideUp";
const VS_CAROUSEL = "carousel";

const VINYL_SLIDEUP_MS = 520;
const ARC_ANGLE_STEP = 0.205;
const PREVIEW_TRANSITION_MS = 340;

const vinyl = {
  phase: VS_HIDDEN,
  timer: 0,
  w: 0, h: 0,
  cx: 0, cy: 0,
  vinylR: 0,
  ringR: 0,
  vinylY: 0,
  vinylTargetY: 0,
  angle: 0,
  position: 0,
  targetPosition: 0,
  positionVelocity: 0,
  dragStartX: 0,
  dragStartPosition: 0,
  dragLastX: 0,
  dragLastTime: 0,
  dragVelocity: 0,
  dragging: false,
  photos: [],
  selectedIndex: 0,
  previousIndex: 0,
  previewFromIndex: 0,
  previewStartedAt: 0,
  thumbs: [],
  animating: false,
  animFrame: 0,
  lastFrameTime: 0,
  collectionId: null,
  palette: null,
  tonearmLift: 0,
  tonearmTargetLift: 0,
  tonearmLiftVel: 0
};

function setGroupOpacity(group, opacity) {
  var meshCount = 0;
  group.traverse(function (child) {
    if (child.isMesh) {
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(function (m) {
        m.transparent = true;
        m.opacity = opacity;
        m.needsUpdate = true;
      });
      meshCount++;
    }
  });
  console.log("[setGroupOpacity] group.index=" + group.userData?.index, "opacity=" + opacity, "meshes=" + meshCount, "collectionId=" + (group.userData?.collectionId || "?"));
}

function restoreGroupOpacity(group) {
  group.traverse(function (child) {
    if (child.isMesh) {
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(function (m) {
        if (m._origOpacity != null) {
          m.transparent = true;
          m.opacity = m._origOpacity;
        } else {
          m.transparent = false;
          m.opacity = 1;
        }
        m.needsUpdate = true;
      });
    }
  });
}

function makeCollection(id, title, spine, palette, photos = [], criterion = "palette") {
  const collection = {
    id,
    title,
    spine,
    palette,
    photos,
    criterion
  };
  collection.sideLabels = makeSideLabels(collection, photos[0], criterion);
  return collection;
}

const GENRE_SIDE_META = {
  jazz: { en: "Jazz", cn: "爵士乐" },
  hiphop: { en: "Hip-Hop", cn: "嘻哈音乐" },
  folk: { en: "Folk", cn: "民谣音乐" },
  electronic: { en: "Electronic", cn: "电子音乐" },
  cinematic: { en: "Cinematic", cn: "电影音乐" },
  rnb: { en: "R&B", cn: "蓝调音乐" }
};

function getCollectionGenreKey(collection) {
  const text = [collection.id, collection.title, collection.spine].filter(Boolean).join(" ").toLowerCase();
  const compact = text.replace(/[^a-z0-9]/g, "");
  if (text.includes("r&b") || compact.includes("rnb") || compact === "rb") return "rnb";
  if (compact.includes("hiphop")) return "hiphop";
  if (compact.includes("electronic") || compact.includes("elec")) return "electronic";
  if (compact.includes("cinematic") || compact.includes("cine")) return "cinematic";
  if (compact.includes("jazz")) return "jazz";
  if (compact.includes("folk")) return "folk";
  return collection.id || compact || "music";
}

function makeCaseSideLabels(collection, index) {
  const key = getCollectionGenreKey(collection);
  const meta = GENRE_SIDE_META[key] || {};
  const title = meta.en || collection.title || collection.spine || "Music";
  const cnTitle = meta.cn || collection.cnTitle || "音乐内容";
  const volume = `VOL ${Math.max(1, Number(index) + 1 || 1)}`;
  const count = `${collection.photos?.length || 0} songs`;
  return [volume, title, cnTitle, count];
}

const CASE_PRESENT_MS = 1080;
const CASE_OPEN_START_MS = 340;
const CASE_OPEN_MS = 620;
const PORTRAIT_STACK_ROT_X = THREE.MathUtils.degToRad(60);
const PORTRAIT_STACK_Y = 0.42;
const PORTRAIT_STACK_Z = 0.36;
const PORTRAIT_OPEN_ROT_X = THREE.MathUtils.degToRad(0);

function createGenreCover(palette) {
  var canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 640;
  var ctx = canvas.getContext("2d");
  var pr = parseInt(palette.primary.slice(1, 3), 16);
  var pg = parseInt(palette.primary.slice(3, 5), 16);
  var pb = parseInt(palette.primary.slice(5, 7), 16);
  var sr = parseInt(palette.secondary.slice(1, 3), 16);
  var sg = parseInt(palette.secondary.slice(3, 5), 16);
  var sb = parseInt(palette.secondary.slice(5, 7), 16);

  var bgGrad = ctx.createLinearGradient(0, 0, 480, 640);
  bgGrad.addColorStop(0, "rgb(" + Math.round(pr * 0.22) + "," + Math.round(pg * 0.22) + "," + Math.round(pb * 0.22) + ")");
  bgGrad.addColorStop(0.4, "rgb(" + Math.round(pr * 0.12) + "," + Math.round(pg * 0.12) + "," + Math.round(pb * 0.12) + ")");
  bgGrad.addColorStop(1, "#020202");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 480, 640);

  ctx.save();
  ctx.globalAlpha = 0.28;
  var ringGrad = ctx.createRadialGradient(240, 270, 50, 240, 270, 230);
  ringGrad.addColorStop(0, palette.primary);
  ringGrad.addColorStop(0.45, palette.secondary);
  ringGrad.addColorStop(1, "transparent");
  ctx.fillStyle = ringGrad;
  ctx.fillRect(0, 0, 480, 640);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.12;
  for (var i = 0; i < 8; i++) {
    var y = 100 + i * 64;
    ctx.fillStyle = i % 3 === 0 ? palette.primary : (i % 3 === 1 ? palette.secondary : "rgba(255,255,255,0.06)");
    ctx.fillRect(40, y, 400, 1);
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.18;
  var spotGrad = ctx.createRadialGradient(240, 220, 0, 240, 220, 200);
  spotGrad.addColorStop(0, palette.secondary);
  spotGrad.addColorStop(1, "transparent");
  ctx.fillStyle = spotGrad;
  ctx.fillRect(0, 0, 480, 640);
  ctx.restore();

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(0, 0, 480, 640);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.text;
  ctx.shadowColor = palette.primary;
  ctx.shadowBlur = 28;
  ctx.font = "900 52px Impact, 'Arial Black', sans-serif";
  var displayName = palette.name.length > 8 ? palette.name.slice(0, 8) + "…" : palette.name;
  ctx.fillText(displayName, 240, 290, 400);

  ctx.shadowBlur = 0;
  ctx.fillStyle = palette.text === "#222222" ? "rgba(34,34,34,0.5)" : "rgba(255,248,235,0.5)";
  ctx.font = "600 14px Arial, sans-serif";
  ctx.fillText("B-SIDE MUSIC VIDEO", 240, 360);

  return canvas;
}

function createVideoCover(vs, g) {
  var canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 640;
  var ctx = canvas.getContext("2d");

  ctx.fillStyle = "#080808";
  ctx.fillRect(0, 0, 480, 640);

  var glow = ctx.createRadialGradient(240, 200, 30, 240, 360, 340);
  glow.addColorStop(0, g.primary);
  glow.addColorStop(1, "transparent");
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 480, 640);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = g.primary;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(28, 28); ctx.lineTo(452, 28); ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#fff7ea";
  ctx.font = "900 28px Arial, 'PingFang SC', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(truncateText(vs.author, 15), 28, 46);

  ctx.fillStyle = "rgba(255,247,234,.68)";
  ctx.font = "600 16px Arial, 'PingFang SC', sans-serif";
  var lines = wrapText(ctx, truncateText(vs.title, 60), 420);
  for (var li = 0; li < Math.min(lines.length, 3); li++) {
    ctx.fillText(lines[li], 28, 84 + li * 22);
  }

  if (vs.music) {
    ctx.fillStyle = "rgba(255,247,234,.38)";
    ctx.font = "600 12px Arial, 'PingFang SC', sans-serif";
    ctx.fillText(truncateText(vs.music, 42), 28, 156);
  }

  ctx.fillStyle = "rgba(255,255,255,.88)";
  ctx.beginPath(); ctx.arc(240, 310, 42, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.moveTo(226, 288); ctx.lineTo(226, 332); ctx.lineTo(260, 310); ctx.closePath();
  ctx.fill();

  var tagsX = 28;
  (vs.tags || []).slice(0, 4).forEach(function(tag) {
    var tw = ctx.measureText(tag).width + 20;
    ctx.fillStyle = "rgba(255,255,255,.12)";
    roundRect(ctx, tagsX, 580, tw, 24, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255,247,234,.82)";
    ctx.font = "700 11px Arial, 'PingFang SC', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(tag, tagsX + 10, 596);
    tagsX += tw + 8;
  });

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,247,234,.62)";
  ctx.font = "700 11px Arial, sans-serif";
  var engagement = [vs.likes + " 赞", vs.comments + " 评", vs.favorites + " 藏"];
  for (var ei = 0; ei < engagement.length; ei++) {
    ctx.fillText(engagement[ei], 452, 574 + ei * 18);
  }

  return canvas;
}

function wrapText(ctx, text, maxWidth) {
  var words = text.split("");
  var lines = [];
  var current = "";
  for (var i = 0; i < words.length; i++) {
    var test = current + words[i];
    if (ctx.measureText(test).width > maxWidth && current.length > 0) {
      lines.push(current);
      current = words[i];
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function seedSamples() {
  var genres = {
    jazz: { title: "Jazz", spine: "JAZZ TAPE", primary: "#1a2840", secondary: "#3a5a80", text: "#d0dce8", coverUrl: "./assets/covers/jazz.png" },
    hiphop: { title: "Hip-Hop", spine: "HIPHOP TAPE", primary: "#8a1010", secondary: "#c82020", text: "#f0e0e0", coverUrl: "./assets/covers/hiphop.png" },
    rnb: { title: "R&B", spine: "R&B TAPE", primary: "#4a2050", secondary: "#9848a0", text: "#f0e8f0", coverUrl: "./assets/covers/rnb.png" },
    electronic: { title: "Electronic", spine: "ELEC TAPE", primary: "#0a2a4a", secondary: "#1890c8", text: "#d0e8f0", coverUrl: "./assets/covers/electronic.png" },
    folk: { title: "Folk", spine: "FOLK TAPE", primary: "#6a5838", secondary: "#b09870", text: "#f0e8d0", coverUrl: "./assets/covers/folk.png" },
    cinematic: { title: "Cinematic", spine: "CINE TAPE", primary: "#383838", secondary: "#686868", text: "#d0d0d0", coverUrl: "./assets/covers/cinematic.png" }
  };

  var videoSeeds = [
    { genre: "jazz", file: "jazz1.mp4", author: "@听爵士看世界", title: "第134集：永恒的经典\"Misty\" Kyra's Misty cover with Dom and Julian", tags: ["#爵士即兴", "#jazz", "#misty"], music: "汽水音乐: Misty", likes: "2.6万", comments: "264", favorites: "4990", shares: "6805" },
    { genre: "jazz", file: "jazz2.mp4", author: "@AIER极致音乐", title: "之前一直对爵士有偏见，直到我看完这个表演，节奏真的叹为观止", tags: ["#音乐推荐", "#音乐现场", "#爵士乐"], music: "汽水音乐: Jazz Festival", likes: "3.3万", comments: "981", favorites: "8881", shares: "6768" },
    { genre: "jazz", file: "jazz3.mp4", author: "@夜在指尖", title: "保持干净，就是流行爵士即兴中需要的方式", tags: ["#原创音乐", "#钢琴", "#jazz"], music: "汽水音乐: 泛红-承志piano", likes: "25.1万", comments: "2223", favorites: "3.9万", shares: "3.6万" },

    { genre: "hiphop", file: "hiphop1.mp4", author: "@ANR4N", title: "第5集：视频十秒后会出现雷暴 哪首歌是你最喜欢的夏日HIPHOP音乐呢？", tags: ["#hiphopdj", "#inmyfeelings", "#july", "#留学生"], music: "汽水音乐: Late Night Tales: Zero 7", likes: "32.9万", comments: "5293", favorites: "6.5万", shares: "6.0万" },
    { genre: "hiphop", file: "hiphop2.mp4", author: "@方大炮", title: "整个夏天 想和你环游世界", tags: ["#rnb", "#夏天又杀回来了"], music: "汽水音乐: 夏天(Live)", likes: "8.0万", comments: "704", favorites: "6470", shares: "1.2万" },
    { genre: "hiphop", file: "hiphop3.mp4", author: "@oogsehun", title: "oldschool hiphop编舞", tags: ["#hiphop", "#原创编舞", "#oldschool", "#简单易学"], music: "汽水音乐: Late Night Tales: Zero 7 – Continuous Mix", likes: "9543", comments: "93", favorites: "2333", shares: "1796" },

    { genre: "rnb", file: "r&b.mp4", author: "@从天而降的屎壳郎", title: "如果你听腻了流水线的快餐音乐，来听听格莱美认证的\"最佳R&B歌手\"如何用声音讲故事的@Muni_Long", tags: ["#munilong", "#hrshrs", "#mb", "#音乐分享", "#神级现场"], music: "汽水音乐: Hrs&Hrs(cover)", likes: "5.9万", comments: "527", favorites: "7173", shares: "1.2万" },
    { genre: "rnb", file: "r&b2.mp4", author: "@方大炮", title: "整个夏天 想和你环游世界", tags: ["#rnb", "#夏天又杀回来了"], music: "汽水音乐: 夏天(Live)", likes: "8.0万", comments: "704", favorites: "6470", shares: "1.2万" },
    { genre: "rnb", file: "r&b3.mp4", author: "@马杰雪", title: "我的rnb白月光", tags: ["#fallinout", "#keyshiacole", "#rnb", "#翻唱"], music: "汽水音乐: Fallin' Out", likes: "9290", comments: "146", favorites: "787", shares: "365" },

    { genre: "electronic", file: "Electronic1.mp4", author: "@品尝音乐", title: "第24集：【电子舞曲/Electronic】Sacred Melody（神圣的旋律）", tags: ["#戴上耳机", "#电子音乐", "#纯音乐", "#electronic"], music: "汽水音乐: Sacred Melody", likes: "13", comments: "0", favorites: "6", shares: "2" },
    { genre: "electronic", file: "Electronic2.mp4", author: "@小艺笑", title: "歌曲：electronic vibes 歌手：G Sounds", tags: ["#音乐分享", "#音乐推荐"], music: "汽水音乐: Electronic Vibes", likes: "286", comments: "11", favorites: "186", shares: "502" },
    { genre: "electronic", file: "Electronic3.mp4", author: "@_江甲", title: "第10集：感受绚烂霓虹之下的腐臭味，都市之大，没有一束光是给自己的", tags: ["#电音", "#synthwave", "#赛博朋克"], music: "汽水音乐: Time To Pretend", likes: "1.4万", comments: "510", favorites: "6510", shares: "1257" },

    { genre: "folk", file: "Folk1.mp4", author: "@乐棱镜·Musikorama", title: "第34集：Folk界最难被复制的声音，或许没有之一 Big Thief – Double Infinity(2025)", tags: ["#欧美音乐", "#民谣", "#pitchfork"], music: "汽水音乐: Double Infinity", likes: "73", comments: "3", favorites: "5", shares: "7" },

    { genre: "cinematic", file: "Cinematic1.mp4", author: "@Aiden-Echo", title: "\"是AI也是爱\" 电影her混剪", tags: ["#her", "#电影美学", "#电影感"], music: "汽水音乐: I Love You So", likes: "19.5万", comments: "2559", favorites: "2.8万", shares: "2.7万" }
  ];

  var coverByVideo = {
    "jazz1.mp4": "jazz1.jpg",
    "jazz2.mp4": "jazz2.jpg",
    "jazz3.mp4": "jazz3.jpg",
    "hiphop1.mp4": "hiphop1.jpg",
    "hiphop2.mp4": "hiphop2.jpg",
    "hiphop3.mp4": "hiphop3.jpg",
    "r&b.mp4": "r&b.jpg",
    "r&b2.mp4": "r&b2.jpg",
    "r&b3.mp4": "r&b3.jpg",
    "Electronic1.mp4": "Electronic1.jpg",
    "Electronic2.mp4": "Electronic2.jpg",
    "Electronic3.mp4": "Electronic3.jpg",
    "Folk1.mp4": "Folk1.png",
    "Cinematic1.mp4": "Cinematic1.jpg"
  };

  allPhotos = videoSeeds.map(function(vs, i) {
    var g = genres[vs.genre];
    var source = createVideoCover(vs, g);
    var coverFile = coverByVideo[vs.file] || vs.file.replace(/\.mp4$/, ".jpg");
    return {
      id: "video-" + i,
      name: vs.author + " · " + vs.title,
      source: source,
      paletteLabel: vs.author,
      sceneLabel: vs.tags[0],
      paletteKey: vs.genre,
      dominantColor: g.primary,
      timeLabel: "音乐视频",
      timeKey: "video",
      timeSource: "video",
      locationLabel: vs.tags[1] || "",
      locationKey: "video-" + vs.genre,
      locationSource: "video",
      deviceLabel: "",
      deviceKey: "",
      thumbUrl: "",
      storedDataUrl: "",
      criterionSource: "palette",
      manualGroupByCriterion: {
        palette: { key: vs.genre, title: g.title, spine: g.spine, primary: g.primary, secondary: g.secondary, text: g.text, coverUrl: g.coverUrl }
      },
      videoUrl: "./assets/videos/" + vs.file,
      coverUrl: "./assets/covers/" + coverFile,
      videoAuthor: vs.author,
      videoTitle: vs.title,
      videoTags: vs.tags,
      videoMusic: vs.music,
      videoLikes: vs.likes,
      videoComments: vs.comments,
      videoFavorites: vs.favorites,
      videoShares: vs.shares
    };
  });

  app.currentCriterion = "palette";
}

async function boot() {
  try {
    await removeStoredLibrary();
    seedSamples();
    collections = buildCollections(app.currentCriterion);
    setupThree();
    setupEvents();
    updateCaption();
    tick();
  } catch (err) {
    console.error("boot error:", err);
    showError(err);
  }
}

function setupThree() {
  app.renderer = new THREE.WebGLRenderer({
    canvas: sceneCanvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  app.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  app.renderer.outputColorSpace = THREE.SRGBColorSpace;

  app.scene = new THREE.Scene();
  app.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  app.camera.position.set(0, 0.18, 8.6);
  app.camera.lookAt(0, 0, 0);

  app.scene.add(new THREE.AmbientLight(0xffffff, 1.45));
  const key = new THREE.DirectionalLight(0xffffff, 2.75);
  key.position.set(-3, 4, 7);
  app.scene.add(key);
  const rim = new THREE.DirectionalLight(0xe9ddc8, 1.7);
  rim.position.set(4, -1, 5);
  app.scene.add(rim);

  app.groups = collections.map((collection, index) => createCaseGroup(collection, index));
  app.titlePlane = createTitlePlane(collections[0] || { title: "B-SIDE" });
  resize();
}

function createCaseGroup(collection, index) {
  const group = new THREE.Group();
  group.userData = { collectionId: collection.id, index };

  const coverTexture = makeCoverTexture(collection);
  const caseSideLabels = makeCaseSideLabels(collection, index);
  collection.sideLabels = caseSideLabels;
  const mainSpineTexture = makeSideTexture(collection, caseSideLabels[0], "spine", true);
  const locationSpineTexture = makeSideTexture(collection, caseSideLabels[1], "spine", false, true);
  const backTexture = makeTextTexture(collection, "back");
  const timeSpineTexture = makeFrontSpineTexture(collection, caseSideLabels[2], false, false);
  const deviceSpineTexture = makeFrontSpineTexture(collection, caseSideLabels[3], false, true);
  const mainSpineMaterial = new THREE.MeshPhysicalMaterial({
    map: mainSpineTexture,
    metalness: 0,
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.14
  });
  const locationSpineMaterial = new THREE.MeshPhysicalMaterial({
    map: locationSpineTexture,
    metalness: 0,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.16
  });
  const timeSpineMaterial = new THREE.MeshPhysicalMaterial({
    map: timeSpineTexture,
    metalness: 0,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.12
  });
  const deviceSpineMaterial = new THREE.MeshPhysicalMaterial({
    map: deviceSpineTexture,
    metalness: 0,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.12
  });
  const coverMaterial = new THREE.MeshStandardMaterial({ map: coverTexture, roughness: 0.45 });
  const backMaterial = new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.52 });

  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.42, 2.42, 0.36, 1, 1, 1),
    [mainSpineMaterial, locationSpineMaterial, timeSpineMaterial, deviceSpineMaterial, coverMaterial, backMaterial]
  );
  group.add(caseMesh);

  const lidPivot = new THREE.Group();
  lidPivot.position.set(-1.21, 0, 0.22);
  const lidCover = new THREE.Mesh(
    new THREE.PlaneGeometry(2.42, 2.42),
    new THREE.MeshStandardMaterial({
      map: coverTexture,
      roughness: 0.36,
      side: THREE.DoubleSide
    })
  );
  lidCover.position.set(1.21, 0, 0.018);
  lidPivot.add(lidCover);

  const lidPlastic = new THREE.Mesh(
    new THREE.PlaneGeometry(2.48, 2.48),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide
    })
  );
  lidPlastic.material._origOpacity = 0.18;
  lidPlastic.position.set(1.21, 0, 0.024);
  lidPivot.add(lidPlastic);

  group.userData.lidPivot = lidPivot;
  group.add(lidPivot);

  const plastic = new THREE.Mesh(
    new THREE.PlaneGeometry(2.48, 2.48),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide
    })
  );
  plastic.material._origOpacity = 0.24;
  plastic.position.z = 0.188;
  group.add(plastic);

  // CD disc image inside the case
  const cdTexture = new THREE.TextureLoader().load("./assets/cd.png");
  const cdDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(2.42, 2.42),
    new THREE.MeshStandardMaterial({
      map: cdTexture,
      roughness: 0.3
    })
  );
  cdDisc.position.z = 0.184;
  group.add(cdDisc);

  const hinge = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 2.46, 0.4),
    new THREE.MeshPhysicalMaterial({
      color: 0xf0eadf,
      roughness: 0.08,
      clearcoat: 1,
      transparent: true,
      opacity: 0.38
    })
  );
  hinge.material._origOpacity = 0.38;
  hinge.position.set(-1.11, 0, 0.03);
  group.add(hinge);

  app.scene.add(group);
  return group;
}

function createTitlePlane(collection) {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 1.72),
    new THREE.MeshBasicMaterial({
      map: makeAlbumTitleTexture(collection.title),
      transparent: true,
      opacity: 0.68,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  plane.visible = false;
  plane.renderOrder = -1;
  app.scene.add(plane);
  app.titlePlaneTitle = collection.title;
  return plane;
}

function makeAlbumTitleTexture(title) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 512;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "rgba(255,248,232,.92)";
  c.shadowColor = "rgba(255,248,232,.5)";
  c.shadowBlur = 32;
  c.font = "900 330px Impact, \"Arial Black\", \"PingFang SC\", sans-serif";
  c.fillText(title, canvas.width / 2, canvas.height / 2 + 12, canvas.width - 120);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function updateTitlePlane(collection) {
  if (!app.titlePlane || app.titlePlaneTitle === collection.title) return;
  const oldMap = app.titlePlane.material.map;
  app.titlePlane.material.map = makeAlbumTitleTexture(collection.title);
  app.titlePlane.material.needsUpdate = true;
  oldMap?.dispose();
  app.titlePlaneTitle = collection.title;
}

function makeCoverTexture(collection) {
  var canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  var c = canvas.getContext("2d");
  var gradient = c.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, collection.palette.primary);
  gradient.addColorStop(1, "#020202");
  var shade = c.createLinearGradient(0, 0, 1024, 1024);
  shade.addColorStop(0, "rgba(255,255,255,.18)");
  shade.addColorStop(0.22, "rgba(255,255,255,0)");
  shade.addColorStop(0.64, "rgba(0,0,0,.1)");
  shade.addColorStop(1, "rgba(0,0,0,.24)");

  function drawCoverFrame(src) {
    c.clearRect(0, 0, 1024, 1024);
    c.fillStyle = gradient;
    c.fillRect(0, 0, 1024, 1024);
    if (src) drawCoverImage(c, src, 72, 72, 880, 880);
    c.fillStyle = shade;
    c.fillRect(0, 0, 1024, 1024);
    c.strokeStyle = "rgba(255,255,255,.22)";
    c.lineWidth = 8;
    c.strokeRect(72, 72, 880, 880);
  }

  drawCoverFrame(collection.photos[0]?.source);

  var coverUrl = collection.palette.coverUrl;
  if (coverUrl) {
    var img = new Image();
    img.onload = function() {
      c.clearRect(0, 0, 1024, 1024);
      c.drawImage(img, -52, -52, 1128, 1128);
      texture.needsUpdate = true;
    };
    img.src = coverUrl;
  }

  var texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeSideLabels(collection, photo, criterion) {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const LOC_EN = {
    // 中国省份
    "广东": "Guangdong", "上海": "Shanghai", "北京": "Beijing", "四川": "Sichuan",
    "浙江": "Zhejiang", "江苏": "Jiangsu", "云南": "Yunnan", "福建": "Fujian",
    "山东": "Shandong", "陕西": "Shaanxi", "中国": "China", "未知地点": "Unknown",
    "海南": "Hainan", "广西": "Guangxi", "贵州": "Guizhou", "湖南": "Hunan",
    "湖北": "Hubei", "河南": "Henan", "河北": "Hebei", "山西": "Shanxi",
    "安徽": "Anhui", "江西": "Jiangxi", "黑龙江": "Heilongjiang", "吉林": "Jilin",
    "辽宁": "Liaoning", "内蒙古": "Inner Mongolia", "新疆": "Xinjiang", "西藏": "Tibet",
    "青海": "Qinghai", "甘肃": "Gansu", "宁夏": "Ningxia", "天津": "Tianjin",
    "重庆": "Chongqing",
    // 中国城市
    "成都": "Chengdu", "杭州": "Hangzhou", "南京": "Nanjing", "西安": "Xi'an",
    "重庆": "Chongqing", "武汉": "Wuhan", "苏州": "Suzhou", "长沙": "Changsha",
    "青岛": "Qingdao", "大连": "Dalian", "厦门": "Xiamen", "昆明": "Kunming",
    "哈尔滨": "Harbin", "深圳": "Shenzhen", "广州": "Guangzhou", "珠海": "Zhuhai",
    "三亚": "Sanya", "桂林": "Guilin", "拉萨": "Lhasa", "洛阳": "Luoyang",
    "开封": "Kaifeng", "敦煌": "Dunhuang", "丽江": "Lijiang", "大理": "Dali",
    "九寨沟": "Jiuzhaigou", "黄山": "Huangshan", "泰山": "Mount Tai",
    "峨眉山": "Mount Emei", "张家界": "Zhangjiajie", "婺源": "Wuyuan",
    "凤凰": "Fenghuang", "西塘": "Xitang", "乌镇": "Wuzhen",
    // 日本
    "东京": "Tokyo", "大阪": "Osaka", "京都": "Kyoto", "奈良": "Nara",
    "北海道": "Hokkaido", "冲绳": "Okinawa", "名古屋": "Nagoya", "福冈": "Fukuoka",
    "横滨": "Yokohama", "神户": "Kobe", "镰仓": "Kamakura", "富士山": "Mt. Fuji",
    "箱根": "Hakone", "札幌": "Sapporo", "长崎": "Nagasaki", "广岛": "Hiroshima",
    "Japan": "Japan",
    // 韩国
    "首尔": "Seoul", "釜山": "Busan", "济州": "Jeju", "济州岛": "Jeju",
    "仁川": "Incheon", "大邱": "Daegu", "庆州": "Gyeongju",
    "Korea": "Korea",
    // 东南亚
    "曼谷": "Bangkok", "清迈": "Chiang Mai", "普吉": "Phuket", "芭提雅": "Pattaya",
    "巴厘岛": "Bali", "雅加达": "Jakarta", "泗水": "Surabaya",
    "新加坡": "Singapore", "吉隆坡": "Kuala Lumpur", "槟城": "Penang", "兰卡威": "Langkawi",
    "马尼拉": "Manila", "长滩岛": "Boracay", "河内": "Hanoi", "胡志明": "Ho Chi Minh",
    "岘港": "Da Nang", "暹粒": "Siem Reap", "金边": "Phnom Penh", "仰光": "Yangon",
    "Thailand": "Thailand", "Indonesia": "Indonesia", "Vietnam": "Vietnam",
    "Malaysia": "Malaysia", "Philippines": "Philippines", "Cambodia": "Cambodia",
    // 欧洲
    "巴黎": "Paris", "伦敦": "London", "罗马": "Rome", "米兰": "Milan",
    "威尼斯": "Venice", "佛罗伦萨": "Florence", "巴塞罗那": "Barcelona",
    "马德里": "Madrid", "柏林": "Berlin", "慕尼黑": "Munich", "维也纳": "Vienna",
    "布拉格": "Prague", "阿姆斯特丹": "Amsterdam", "布鲁塞尔": "Brussels",
    "苏黎世": "Zurich", "日内瓦": "Geneva", "斯德哥尔摩": "Stockholm",
    "哥本哈根": "Copenhagen", "赫尔辛基": "Helsinki", "雅典": "Athens",
    "里斯本": "Lisbon", "莫斯科": "Moscow", "伊斯坦布尔": "Istanbul",
    "Dubrovnik": "Dubrovnik", "Santorini": "Santorini", "Mykonos": "Mykonos",
    "France": "France", "Italy": "Italy", "Spain": "Spain", "Germany": "Germany",
    "United Kingdom": "UK", "Greece": "Greece", "Portugal": "Portugal",
    "Netherlands": "Netherlands", "Switzerland": "Switzerland", "Austria": "Austria",
    "Czech Republic": "Czechia", "Sweden": "Sweden", "Denmark": "Denmark",
    "Norway": "Norway", "Finland": "Finland", "Russia": "Russia", "Turkey": "Turkey",
    // 北美
    "纽约": "New York", "洛杉矶": "Los Angeles", "旧金山": "San Francisco",
    "芝加哥": "Chicago", "拉斯维加斯": "Las Vegas", "迈阿密": "Miami",
    "华盛顿": "Washington D.C.", "波士顿": "Boston", "西雅图": "Seattle",
    "夏威夷": "Hawaii", "多伦多": "Toronto", "温哥华": "Vancouver",
    "蒙特利尔": "Montreal", "墨西哥": "Mexico", "坎昆": "Cancun",
    "USA": "USA", "Canada": "Canada", "Mexico": "Mexico",
    // 大洋洲
    "悉尼": "Sydney", "墨尔本": "Melbourne", "奥克兰": "Auckland",
    "Australia": "Australia", "New Zealand": "New Zealand",
    // 中东/非洲
    "迪拜": "Dubai", "阿布扎比": "Abu Dhabi", "开罗": "Cairo",
    "毛里求斯": "Mauritius", "马尔代夫": "Maldives", "塞舌尔": "Seychelles",
    "南非": "South Africa", "肯尼亚": "Kenya", "摩洛哥": "Morocco",
    // 南美
    "里约": "Rio", "圣保罗": "São Paulo", "布宜诺斯艾利斯": "Buenos Aires",
    "秘鲁": "Peru", "智利": "Chile", "阿根廷": "Argentina", "巴西": "Brazil"
  };

  function toPinyin(text) {
    if (!text) return "Unknown";
    if (LOC_EN[text]) return LOC_EN[text];
    if (/^[\x00-\x7F]+$/.test(text)) return text;
    const PY = {
      "阿":"A","安":"An","澳":"Ao","八":"Ba","白":"Bai","百":"Bai","半":"Ban","包":"Bao","宝":"Bao","北":"Bei","本":"Ben","碧":"Bi","冰":"Bing","波":"Bo","伯":"Bo","博":"Bo","不":"Bu","才":"Cai","仓":"Cang","长":"Chang","朝":"Chao","成":"Cheng","城":"Cheng","池":"Chi","赤":"Chi","楚":"Chu","川":"Chuan","春":"Chun","慈":"Ci","翠":"Cui","村":"Cun","达":"Da","大":"Da","丹":"Dan","岛":"Dao","道":"Dao","德":"De","迪":"Di","地":"Di","典":"Dian","甸":"Dian","东":"Dong","冬":"Dong","都":"Du","度":"Du","敦":"Dun","多":"Duo","俄":"E","尔":"Er","法":"Fa","番":"Fan","飞":"Fei","丰":"Feng","凤":"Feng","佛":"Fo","福":"Fu","抚":"Fu","阜":"Fu","甘":"Gan","冈":"Gang","港":"Gang","高":"Gao","格":"Ge","根":"Gen","古":"Gu","谷":"Gu","关":"Guan","光":"Guang","广":"Guang","贵":"Gui","桂":"Gui","国":"Guo","哈":"Ha","海":"Hai","邯":"Han","韩":"Han","汉":"Han","杭":"Hang","好":"Hao","合":"He","和":"He","河":"He","鹤":"He","黑":"Hei","衡":"Heng","红":"Hong","洪":"Hong","湖":"Hu","虎":"Hu","花":"Hua","华":"Hua","化":"Hua","淮":"Huai","皇":"Huang","黄":"Huang","惠":"Hui","吉":"Ji","济":"Ji","集":"Ji","加":"Jia","嘉":"Jia","尖":"Jian","建":"Jian","江":"Jiang","焦":"Jiao","金":"Jin","津":"Jin","锦":"Jin","晋":"Jin","京":"Jing","景":"Jing","九":"Jiu","酒":"Jiu","居":"Ju","喀":"Ka","开":"Kai","坎":"Kan","康":"Kang","克":"Ke","昆":"Kun","拉":"La","莱":"Lai","兰":"Lan","廊":"Lang","老":"Lao","乐":"Le","雷":"Lei","梨":"Li","丽":"Li","利":"Li","历":"Li","连":"Lian","莲":"Lian","良":"Liang","凉":"Liang","辽":"Liao","林":"Lin","临":"Lin","灵":"Ling","柳":"Liu","六":"Liu","龙":"Long","隆":"Long","陇":"Long","庐":"Lu","鲁":"Lu","陆":"Lu","鹿":"Lu","吕":"Lu","洛":"Luo","马":"Ma","玛":"Ma","麦":"Mai","满":"Man","芒":"Mang","茂":"Mao","眉":"Mei","梅":"Mei","蒙":"Meng","孟":"Meng","弥":"Mi","密":"Mi","绵":"Mian","苗":"Miao","庙":"Miao","闽":"Min","明":"Ming","鸣":"Ming","莫":"Mo","墨":"Mo","漠":"Mo","牟":"Mu","牡":"Mu","木":"Mu","沐":"Mu","那":"Na","南":"Nan","内":"Nei","尼":"Ni","宁":"Ning","农":"Nong","怒":"Nu","诺":"Nuo","攀":"Pan","盘":"Pan","平":"Ping","莆":"Pu","濮":"Pu","普":"Pu","七":"Qi","齐":"Qi","奇":"Qi","棋":"Qi","黔":"Qian","桥":"Qiao","秦":"Qin","青":"Qing","清":"Qing","琼":"Qiong","丘":"Qiu","曲":"Qu","泉":"Quan","日":"Ri","荣":"Rong","容":"Rong","融":"Rong","如":"Ru","汝":"Ru","瑞":"Rui","萨":"Sa","三":"San","桑":"Sang","山":"Shan","汕":"Shan","商":"Shang","上":"Shang","韶":"Shao","邵":"Shao","深":"Shen","沈":"Shen","十":"Shi","石":"Shi","寿":"Shou","双":"Shuang","水":"Shui","顺":"Shun","四":"Si","松":"Song","苏":"Su","宿":"Su","绥":"Sui","随":"Sui","遂":"Sui","太":"Tai","泰":"Tai","唐":"Tang","桃":"Tao","天":"Tian","铁":"Tie","通":"Tong","同":"Tong","铜":"Tong","图":"Tu","吐":"Tu","万":"Wan","潍":"Wei","威":"Wei","温":"Wen","文":"Wen","翁":"Weng","乌":"Wu","吴":"Wu","梧":"Wu","武":"Wu","五":"Wu","婺":"Wu","西":"Xi","锡":"Xi","溪":"Xi","厦":"Xia","仙":"Xian","咸":"Xian","香":"Xiang","湘":"Xiang","襄":"Xiang","孝":"Xiao","新":"Xin","信":"Xin","兴":"Xing","邢":"Xing","徐":"Xu","许":"Xu","宣":"Xuan","雪":"Xue","雅":"Ya","烟":"Yan","延":"Yan","盐":"Yan","燕":"Yan","扬":"Yang","阳":"Yang","伊":"Yi","宜":"Yi","益":"Yi","银":"Yin","鹰":"Ying","营":"Ying","永":"Yong","榆":"Yu","渝":"Yu","玉":"Yu","元":"Yuan","岳":"Yue","云":"Yun","运":"Yun","枣":"Zao","张":"Zhang","漳":"Zhang","肇":"Zhao","浙":"Zhe","镇":"Zhen","郑":"Zheng","芝":"Zhi","中":"Zhong","舟":"Zhou","珠":"Zhu","株":"Zhu","驻":"Zhu","庄":"Zhuang","淄":"Zi","自":"Zi","遵":"Zun",
      "芭":"Ba","厘":"Li","首":"Shou","釜":"Fu","仁":"Ren","曼":"Man","迈":"Mai","提":"Ti","坡":"Po","滩":"Tan","岘":"Xian","暹":"Xian","粒":"Li","边":"Bian","仰":"Yang","黎":"Li","伦":"Lun","柏":"Bai","慕":"Mu","纳":"Na","姆":"Mu","坦":"Tan","纽":"Niu","约":"Yue","杉":"Shan","矶":"Ji","旧":"Jiu","盛":"Sheng","顿":"Dun","士":"Shi","悉":"Xi","扎":"Zha","求":"Qiu","舌":"She","拜":"Bai","夷":"Yi","葡":"Pu","萄":"Tao","牙":"Ya","匈":"Xiong","利":"Li","挪":"Nuo","冰":"Bing","爱":"Ai","比":"Bi","荷":"He","卢":"Lu","森":"Sen","堡":"Bao","腊":"La","捷":"Jie","斯":"Si","伐":"Fa","克":"Ke","波":"Bo","兰":"Lan","乌克兰":"WuKeLan","以":"Yi","色":"Se","列":"Lie","埃":"Ai","及":"Ji","肯":"Ken","尼":"Ni","南非":"NanFei","巴西":"BaXi","阿根廷":"Agenting","秘":"Bi","鲁":"Lu","智":"Zhi","哥":"Ge","斯":"Si","达":"Da","黎":"Li","斐":"Fei","济":"Ji","汤":"Tang","加":"Jia","拿":"Na","澳":"Ao","新西兰":"XinXiLan","斐":"Fei","济":"Ji","大溪地":"DaXiDi","关":"Guan","塞":"Sai","班":"Ban","牙":"Ya","古":"Gu","巴":"Ba","哈":"Ha","瓦":"Wa","那":"Na","苏":"Su","黎":"Li","世":"Shi","帕":"Pa","劳":"Lao","文":"Wen","莱":"Lai","西":"Xi","亚":"Ya","缅":"Mian","甸":"Dian","老":"Lao","挝":"Wo","不":"Bu","丹":"Dan","尼":"Ni","泊":"Bo","尔":"Er","孟":"Meng","加":"Jia","拉":"La","国":"Guo","斯":"Si","里":"Li","兰":"Lan","卡":"Ka","塔":"Ta"
    };
    let result = "";
    for (const ch of text) {
      const p = PY[ch];
      if (p) {
        result += p;
      } else if (ch.charCodeAt(0) >= 0x4E00 && ch.charCodeAt(0) <= 0x9FFF) {
        result += ch;
      } else {
        result += ch;
      }
    }
    return result || text;
  }

  let cn, en;
  if (criterion === "time") {
    const key = collection.spine || "";
    const match = key.match(/^(\d{4})\.(\d{2})$/);
    if (match) {
      const mi = Number(match[2]) - 1;
      cn = `${match[1]}年${Number(match[2])}月`;
      en = `${MONTHS[mi] || ""} ${match[1]}`;
    } else {
      cn = collection.title || "未知时间";
      en = key || "Unknown";
    }
  } else if (criterion === "location") {
    cn = collection.title || "未知地点";
    en = toPinyin(collection.title) || "Unknown";
  } else {
    cn = collection.title || "暖色";
    en = collection.spine || "WARM";
  }

  return [cn, cn, en, en];
}


function makeTextTexture(collection, mode) {
  return makeSideTexture(collection, mode === "spine" ? collection.spine : collection.title, mode, mode === "spine");
}

function makeSideTexture(collection, label, mode, emphasis = false, opposite = false) {
  const canvas = document.createElement("canvas");
  canvas.width = mode === "spine" ? 192 : 768;
  canvas.height = 1024;
  const c = canvas.getContext("2d");
  const gradient = c.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, collection.palette.primary);
  gradient.addColorStop(1, collection.palette.secondary);
  c.fillStyle = gradient;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "rgba(255,255,255,.16)";
  c.fillRect(0, 0, mode === "spine" ? 22 : 34, canvas.height);
  c.fillRect(canvas.width - (mode === "spine" ? 18 : 28), 0, mode === "spine" ? 18 : 28, canvas.height);

  c.save();
  c.translate(canvas.width / 2, canvas.height / 2);
  c.rotate(opposite ? -Math.PI / 2 : Math.PI / 2);
  c.textBaseline = "middle";
  c.fillStyle = collection.palette.text;
  c.textAlign = "center";
  c.font = `${emphasis ? 700 : 500} ${mode === "spine" ? (emphasis ? 48 : 44) : (emphasis ? 56 : 44)}px "Helvetica Neue", "PingFang SC", Helvetica, "Songti SC", Georgia, serif`;
  c.fillText(label, 0, 0, canvas.height - 200);
  c.restore();

  return new THREE.CanvasTexture(canvas);
}

function makeFrontSpineTexture(collection, label = collection.spine, emphasis = false, opposite = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const c = canvas.getContext("2d");

  if (opposite) {
    c.translate(canvas.width, canvas.height);
    c.rotate(Math.PI);
  }

  const gradient = c.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, collection.palette.secondary);
  gradient.addColorStop(0.46, collection.palette.primary);
  gradient.addColorStop(1, collection.palette.secondary);
  c.fillStyle = gradient;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "rgba(255,255,255,.18)";
  c.fillRect(0, 0, canvas.width, 2);
  c.fillRect(0, canvas.height - 3, canvas.width, 3);
  c.fillStyle = collection.palette.text;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `${emphasis ? 700 : 500} ${emphasis ? 52 : 44}px "Helvetica Neue", "PingFang SC", Helvetica, "Songti SC", Georgia, serif`;
  c.fillText(label, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 80);

  return new THREE.CanvasTexture(canvas);
}

function setCaseLidOpen(group, amount) {
  const lid = group.userData?.lidPivot;
  if (!lid) return;
  const t = clamp(amount, 0, 1);
  const eased = t * t * (3 - 2 * t);
  const target = -Math.PI * 0.58 * eased;
  lid.rotation.y += (target - lid.rotation.y) * 0.18;
}

function completeCasePresentation() {
  if (app.presentationPhase !== "scattering") return;
  clearTimeout(app.presentationTimeout);
  app.presentationPhase = "presenting";
  app.presentationTimer = CASE_PRESENT_MS;
  app.presentationTimeout = 0;
  initVinylStage();
  const collection = collections[app.selectedIndex] || collections[0];
  vinyl.photos = collection.photos.slice();
  vinyl.selectedIndex = 0;
  vinyl.previousIndex = 0;
  vinyl.previewFromIndex = 0;
  vinyl.previewStartedAt = performance.now();
  vinyl.position = 0;
  vinyl.targetPosition = 0;
  vinyl.positionVelocity = 0;
  vinyl.dragVelocity = 0;
  vinyl.angle = 0;
  vinyl.thumbs = vinyl.photos.map(function(photo) {
    var c = document.createElement("canvas");
    var size = 260;
    var sw = photo.source.width || 480;
    var sh = photo.source.height || 640;
    var ratio = sw / sh;
    c.width = Math.max(80, Math.round(size * ratio));
    c.height = size;
    var tctx = c.getContext("2d");
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(photo.source, 0, 0, c.width, c.height);
    return c;
  });
  vinyl.photos.forEach(function(photo) {
    if (photo.coverUrl && !photo._coverImg) {
      var img = new Image();
      img.onload = function() {
        photo._coverImg = img;
        console.log("[vinyl] cover loaded: " + photo.coverUrl);
      };
      img.onerror = function() {
        console.error("[vinyl] cover failed: " + photo.coverUrl);
      };
      img.src = photo.coverUrl;
    }
  });
  vinyl.collectionId = collection.id;
  vinyl.palette = collection.palette;
  vinyl.phase = VS_SLIDEUP;
  vinyl.timer = performance.now();
  vinyl.lastFrameTime = vinyl.timer;
  vinyl.vinylY = vinyl.h + vinyl.vinylR * 1.1;
  vinyl.vinylTargetY = vinyl.cy;
  startVinylLoop();
}

function tick() {
  try {
    app.frame = requestAnimationFrame(tick);

    const now = performance.now();
    const dtMs = app.lastTickTime ? Math.min(now - app.lastTickTime, 50) : 16.67;
    app.lastTickTime = now;

    if (app.presentationPhase === "scattering") {
      app.presentationTimer += dtMs;
      if (app.presentationTimer >= CASE_PRESENT_MS) {
        console.log("[tick] case open complete, transitioning to presenting");
        completeCasePresentation();
      }
    }

    app.shelfPosition += (app.targetPosition - app.shelfPosition) * 0.075;
    app.spin += (app.spinTarget - app.spin) * 0.09;
    const portrait = innerHeight >= innerWidth;

    const isAnimating = app.presentationPhase === "scattering" || app.presentationPhase === "presenting";

    app.groups.forEach((group, index) => {
      const delta = index - app.shelfPosition;
      const clamped = Math.max(-8, Math.min(8, delta));
      const isFlipped = app.flippedId === group.userData.collectionId;
      const flippedIndex = app.flippedId ? collections.findIndex((item) => item.id === app.flippedId) : -1;
      const isReceding = Boolean(app.flippedId && !isFlipped);
      const retreatDirection = index > flippedIndex ? 1 : -1;

      let targetX, targetY, targetZ, targetRotX, targetRotY, targetRotZ, targetScale;
      if (portrait) {
        const spiralPhase = app.spin * 0.38 + index * 0.13;
        const focusFalloff = 1 - Math.min(Math.abs(clamped) * 0.08, 0.34);
        const openAmount = app.presentationPhase === "presenting"
          ? 1
          : clamp((app.presentationTimer - CASE_OPEN_START_MS) / CASE_OPEN_MS, 0, 1);

        if (isAnimating && app.flippedId) {
          const spread = index - flippedIndex;
          if (isFlipped) {
            targetX = 0;
            targetY = 1.06;
            targetZ = 2.86;
            targetRotX = PORTRAIT_OPEN_ROT_X;
            targetRotZ = 0;
            targetScale = 0.76;
            targetRotY = 0;
            setCaseLidOpen(group, openAmount);
          } else {
            targetX = 0;
            targetRotY = 0;
            targetY = spread < 0
              ? 2.5 + Math.abs(spread) * 0.22
              : -1.05 - Math.abs(spread) * 0.34;
            targetZ = -0.5 - Math.abs(spread) * 0.08;
            targetRotX = PORTRAIT_STACK_ROT_X;
            targetRotZ = spiralPhase * focusFalloff;
            targetScale = 0.52 - Math.min(Math.abs(spread) * 0.026, 0.11);
            setCaseLidOpen(group, 0);
          }
        } else if (app.flippedId) {
          const spread = index - flippedIndex;
          if (isFlipped) {
            targetY = 1.06;
            targetZ = 2.86;
            targetRotX = PORTRAIT_OPEN_ROT_X;
            targetRotZ = 0;
            targetScale = 0.76;
            setCaseLidOpen(group, 1);
          } else {
            targetY = spread < 0
              ? 2.5 + Math.abs(spread) * 0.22
              : -1.05 - Math.abs(spread) * 0.34;
            targetZ = -0.5 - Math.abs(spread) * 0.08;
            targetRotX = PORTRAIT_STACK_ROT_X;
            targetRotZ = spiralPhase * 0.62;
            targetScale = 0.46 - Math.min(Math.abs(spread) * 0.026, 0.1);
            setCaseLidOpen(group, 0);
          }
          targetX = 0;
          targetRotY = 0;
        } else {
          targetX = 0;
          targetRotY = 0;
          targetY = PORTRAIT_STACK_Y - clamped * 0.58;
          targetZ = PORTRAIT_STACK_Z - Math.abs(clamped) * 0.022;
          targetRotX = PORTRAIT_STACK_ROT_X;
          targetRotZ = spiralPhase * focusFalloff;
          targetScale = 0.78 - Math.min(Math.abs(clamped) * 0.02, 0.1);
          setCaseLidOpen(group, 0);
        }
      } else {
        setCaseLidOpen(group, isFlipped ? 1 : 0);
        targetX = isFlipped ? 0 : clamped * 0.76 + (isReceding ? retreatDirection * 4.6 : 0);
        targetY = isFlipped ? -0.04 : Math.abs(clamped) * -0.015;
        targetZ = isFlipped ? 2.04 : (isReceding ? -1.45 : 0.05) - Math.abs(clamped) * 0.08;
        targetRotX = 0;
        targetRotY = THREE.MathUtils.degToRad(isFlipped ? 0 : 68 - clamped * 1.3);
        targetRotZ = THREE.MathUtils.degToRad(isFlipped ? 0 : clamped * -0.55);
        targetScale = isFlipped ? 0.98 : (isReceding ? 0.72 : 1) - Math.min(Math.abs(clamped) * 0.035, 0.24);
      }

      group.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.11);

      if (isFlipped && app.presentationPhase === "scattering") {
        group.rotation.y = targetRotY;
      } else {
        group.rotation.y += (targetRotY - group.rotation.y) * 0.11;
      }
      group.rotation.x += (targetRotX - group.rotation.x) * 0.11;
      group.rotation.z += (targetRotZ - group.rotation.z) * 0.11;
      const nextScale = group.scale.x + (targetScale - group.scale.x) * 0.11;
      group.scale.setScalar(nextScale);

      if (isAnimating && app.flippedId && !isFlipped) {
        var dimT = app.presentationPhase === "presenting" ? 1 : Math.min(app.presentationTimer / CASE_PRESENT_MS, 1);
        var dimOpacity = 1 - dimT * 0.54;
        if (Math.abs((group.userData._dimOpacity || 1) - dimOpacity) > 0.025) {
          setGroupOpacity(group, dimOpacity);
          group.userData._dimOpacity = dimOpacity;
        }
        group.userData._faded = true;
        group.visible = true;
      }

      if (!isAnimating) {
        if (group.userData._faded) {
          restoreGroupOpacity(group);
          group.userData._faded = false;
          group.userData._dimOpacity = 1;
        }
        group.visible = Math.abs(clamped) < (portrait ? 8 : 8) || isReceding || isFlipped;
      } else if (!group.userData._faded) {
        group.visible = Math.abs(clamped) < (portrait ? 8 : 8) || isReceding || isFlipped;
      }
    });

    if (app.titlePlane) {
      app.titlePlane.visible = false;
    }

    app.renderer.render(app.scene, app.camera);
  } catch (err) {
    showError(err);
  }
}

function resize() {
  const w = Math.max(320, innerWidth || 320);
  const h = Math.max(320, innerHeight || 640);
  app.renderer.setSize(w, h, false);
  app.camera.aspect = w / h;
  const portrait = h >= w;
  app.camera.fov = portrait ? 39 : 34;
  app.camera.position.set(0, portrait ? -0.35 : 0.14, portrait ? 10.2 : 8.2);
  app.camera.lookAt(0, 0, 0);
  app.camera.updateProjectionMatrix();
  syncPresentationClass();
  drawDetail();
  if (vinyl.phase !== VS_HIDDEN) resizeVinyl();
}

function setupEvents() {
  addEventListener("resize", resize, { passive: true });
  sceneCanvas.addEventListener("pointerdown", onPointerDown, { passive: true });
  sceneCanvas.addEventListener("pointermove", onPointerMove, { passive: true });
  sceneCanvas.addEventListener("pointerup", onPointerUp, { passive: true });
  sceneCanvas.addEventListener("pointercancel", () => { app.drag = null; }, { passive: true });
  sceneCanvas.addEventListener("click", onCanvasClick, { passive: true });
  sceneCanvas.addEventListener("touchend", onTouchEnd, { passive: true });
  sceneCanvas.addEventListener("wheel", onWheel, { passive: false });
  vinylStage.addEventListener("pointerdown", onVinylPointerDown);
  vinylStage.addEventListener("pointermove", onVinylPointerMove);
  vinylStage.addEventListener("pointerup", onVinylPointerUp);
  vinylStage.addEventListener("pointercancel", onVinylPointerUp);
  vinylStage.addEventListener("click", onVinylClick);
  var detailEntryBtn = document.getElementById("detailEntryBtn");
  detailEntryBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    var photo = vinyl.photos[vinyl.selectedIndex];
    if (photo && photo.videoUrl) openVideoPlayer(photo);
  });
  backBtn.addEventListener("click", () => closeDetail());
  detail.addEventListener("click", function(e) {
    if (e.target === detailCanvas) {
      var w = detailCanvas.width / (Math.min(devicePixelRatio || 1, 2));
      var h = detailCanvas.height / (Math.min(devicePixelRatio || 1, 2));
      var rect = detailCanvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var portrait = h >= w;
      var onPhoto = portrait
        ? (y > h * 0.38 && y < h - 104)
        : (x > w * 0.42);
      if (!onPhoto) closeDetail();
    }
  });
  fmBtn?.addEventListener("click", openFmEntry);
  photoDrawer.addEventListener("click", onDrawerClick);
  drawerGrid.addEventListener("mouseover", onDrawerHover);
  drawerGrid.addEventListener("mouseleave", () => updateCaption());
  var videoEl = document.getElementById("videoEl");
  document.getElementById("videoCloseBtn").addEventListener("click", closeVideoPlayer);
  videoEl.addEventListener("click", toggleVideoPlayPause);
  videoEl.addEventListener("touchstart", onVideoTouchStart, { passive: true });
  videoEl.addEventListener("touchend", onVideoTouchEnd, { passive: true });
  var inlineVideo = document.getElementById("inlineVideo");
  inlineVideo.addEventListener("click", function(e) {
    e.stopPropagation();
    if (inlineVideo.paused) {
      inlineVideo.play().catch(function() {});
      hidePlayIndicator();
      vinyl.tonearmTargetLift = 0;
    } else {
      inlineVideo.pause();
      showPlayIndicator();
      triggerTonearmLift();
    }
  });

  function showToast(text) {
    var toast = document.getElementById("classifyToast");
    var textEl = document.getElementById("classifyToastText");
    if (!toast || !textEl) return;
    textEl.textContent = text;
    toast.style.opacity = "1";
    toast.style.transform = "translate(-50%,-50%) scale(1)";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() {
      toast.style.opacity = "0";
      toast.style.transform = "translate(-50%,-50%) scale(0.9)";
    }, 3500);
  }

  window.addEventListener("bside:classify-add", function(e) {
    var detail = e.detail;
    var genreKey = detail.genre.toLowerCase().replace(/[^a-z]/g, "");
    if (genreKey === "rb") genreKey = "rnb";
    var fileName = detail.fileName;
    var fileUrl = detail.fileUrl;
    var isVideo = detail.isVideo;

    var genreTitles = {
      jazz: "Jazz", hiphop: "HipHop", folk: "Folk",
      electronic: "Electronic", cinematic: "Cinematic", rnb: "R&B"
    };
    var genreSpines = {
      jazz: "JAZZ TAPE", hiphop: "HIPHOP TAPE", folk: "FOLK TAPE",
      electronic: "ELEC TAPE", cinematic: "CINE TAPE", rnb: "R&B TAPE"
    };
    var genreStyles = {
      jazz:        { primary: "#1a2840", secondary: "#3a5a80", text: "#d0dce8", coverUrl: "./assets/covers/jazz.png" },
      hiphop:      { primary: "#8a1010", secondary: "#c82020", text: "#f0e0e0", coverUrl: "./assets/covers/hiphop.png" },
      folk:        { primary: "#6a5838", secondary: "#b09870", text: "#f0e8d0", coverUrl: "./assets/covers/folk.png" },
      electronic:  { primary: "#0a2a4a", secondary: "#1890c8", text: "#d0e8f0", coverUrl: "./assets/covers/electronic.png" },
      cinematic:   { primary: "#383838", secondary: "#686868", text: "#d0d0d0", coverUrl: "./assets/covers/cinematic.png" },
      rnb:         { primary: "#4a2050", secondary: "#9848a0", text: "#f0e8f0", coverUrl: "./assets/covers/rnb.png" }
    };
    var genreDisplay = genreTitles[genreKey] || genreKey;

    function addWithThumb(source) {
      var photo = {
        id: "upload-" + Date.now(),
        name: fileName,
        source: source,
        paletteLabel: genreDisplay,
        sceneLabel: "",
        paletteKey: genreKey,
        dominantColor: (genreStyles[genreKey] || {}).primary || "#888888",
        timeLabel: "导入",
        timeKey: "upload",
        timeSource: "upload",
        locationLabel: "",
        locationKey: "upload-" + genreKey,
        locationSource: "upload",
        deviceLabel: "",
        deviceKey: "",
        thumbUrl: "",
        storedDataUrl: "",
        criterionSource: "palette",
        manualGroupByCriterion: {
          palette: {
            key: genreKey,
            title: genreDisplay,
            spine: genreSpines[genreKey] || genreKey.toUpperCase(),
            primary: (genreStyles[genreKey] || {}).primary || "#888888",
            secondary: (genreStyles[genreKey] || {}).secondary || "#cccccc",
            text: (genreStyles[genreKey] || {}).text || "#222222",
            coverUrl: (genreStyles[genreKey] || {}).coverUrl || ""
          }
        }
      };
      if (isVideo) photo.videoUrl = fileUrl;
      allPhotos.push(photo);
      var targetCollection = null;
      for (var ci = 0; ci < collections.length; ci++) {
        if (collections[ci].id === genreKey) { targetCollection = collections[ci]; break; }
      }
      if (targetCollection) {
        targetCollection.photos.push(photo);
      } else {
        regroupCollections(app.currentCriterion);
      }
      showToast("已识别为 " + genreDisplay + "，已归档到 " + genreDisplay + " CD页");
    }

    if (isVideo) {
      var v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.src = fileUrl;
      v.addEventListener("loadeddata", function() {
        v.currentTime = Math.min(1, v.duration / 2);
      });
      v.addEventListener("seeked", function() {
        var c = document.createElement("canvas");
        c.width = 480; c.height = 640;
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#080808";
        ctx.fillRect(0, 0, 480, 640);
        var scale = Math.max(480 / v.videoWidth, 640 / v.videoHeight);
        var dw = v.videoWidth * scale, dh = v.videoHeight * scale;
        ctx.drawImage(v, (480 - dw) / 2, (640 - dh) / 2, dw, dh);
        addWithThumb(c);
      });
    } else {
      var c = document.createElement("canvas");
      c.width = 480; c.height = 640;
      var ctx = c.getContext("2d");
      var grad = ctx.createLinearGradient(0, 0, 480, 640);
      grad.addColorStop(0, "#1a1714");
      grad.addColorStop(1, "#020202");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 480, 640);
      ctx.fillStyle = "rgba(244,239,232,.5)";
      ctx.font = "900 36px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("♪", 240, 280);
      ctx.font = "600 14px Arial, sans-serif";
      ctx.fillStyle = "rgba(244,239,232,.35)";
      ctx.fillText(fileName, 240, 340);
      addWithThumb(c);
    }
  });
}

function emitBehavior(eventType, data) {
  window.dispatchEvent(new CustomEvent("bside:behavior", {
    detail: { type: eventType, ...data, timestamp: Date.now() }
  }));
}

function openFmEntry() {
  const summary = collections.map(c => ({
    id: c.id,
    title: c.title,
    spine: c.spine,
    count: c.photos.length,
    criterion: c.criterion
  }));
  window.dispatchEvent(new CustomEvent("bside:fm-open", {
    detail: {
      selectedCollection: collections[app.selectedIndex]?.id || null,
      source: "hud-fm-button",
      collections: summary
    }
  }));
}

function onPointerDown(event) {
  if (vinyl.phase !== VS_HIDDEN) return;
  if (app.presentationPhase !== "idle") return;
  app.drag = {
    x: event.clientX,
    y: event.clientY,
    startTarget: app.targetPosition,
    startSpin: app.spinTarget,
    moved: false
  };
}

function onPointerMove(event) {
  if (!app.drag || app.flippedId) return;
  const dx = event.clientX - app.drag.x;
  const dy = event.clientY - app.drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 8) app.drag.moved = true;
  const portrait = innerHeight >= innerWidth;
  const travel = portrait ? dy : dx;
  const spacing = portrait ? 210 : 160;
  const rawTarget = app.drag.startTarget - travel / spacing;
  app.targetPosition = rubberClamp(rawTarget, 0, collections.length - 1, 0.18);
  app.selectedIndex = Math.round(app.targetPosition);
  app.spinTarget = app.drag.startSpin + travel * (portrait ? 0.0026 : 0.012);
  updateCaption();
}

function onPointerUp(event) {
  const drag = app.drag;
  app.drag = null;
  if (!drag) return;
  app.targetPosition = clamp(Math.round(app.targetPosition), 0, collections.length - 1);
  app.selectedIndex = Math.round(app.targetPosition);
  if (drag.moved) {
    app.flippedId = null;
    hideDrawer();
    updateCaption();
    return;
  }
  handleCanvasTap(event.clientX, event.clientY);
}

function onCanvasClick(event) {
  if (app.drag) return;
  handleCanvasTap(event.clientX, event.clientY);
}

function onTouchEnd(event) {
  if (app.drag) return;
  const touch = event.changedTouches[0];
  if (touch) handleCanvasTap(touch.clientX, touch.clientY);
}

let lastTapTime = 0;
function handleCanvasTap(x, y) {
  const now = performance.now();
  if (now - lastTapTime < 300) return;
  lastTapTime = now;
  if (app.presentationPhase !== "idle") {
    hidePresentation();
    return;
  }
  const hit = pickGroup(x, y);
  if (!hit) {
    if (innerWidth > innerHeight && app.flippedId) {
      app.flippedId = null;
      hideDrawer();
      updateCaption();
    }
    return;
  }
  const collection = collections[hit.userData.index];
  app.selectedIndex = hit.userData.index;
  app.targetPosition = app.selectedIndex;
  presentCollection(app.selectedIndex);
}

function onWheel(event) {
  event.preventDefault();
  if (app.flippedId || app.presentationPhase !== "idle") return;
  const direction = event.deltaY > 0 ? 1 : -1;
  app.targetPosition = clamp(app.targetPosition + direction * 0.18, 0, collections.length - 1);
  app.selectedIndex = Math.round(app.targetPosition);
  app.spinTarget += direction * 0.11;
  updateCaption();
}

function pickGroup(x, y) {
  const rect = sceneCanvas.getBoundingClientRect();
  app.pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
  app.pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
  app.raycaster.setFromCamera(app.pointer, app.camera);
  const hits = app.raycaster.intersectObjects(app.groups, true);
  let obj = hits[0]?.object;
  while (obj && !obj.userData.collectionId) obj = obj.parent;
  return obj || null;
}

function updateCaption() {
  const c = collections[app.selectedIndex] || collections[0];
  if (!c) {
    captionTitle.textContent = "";
    captionMeta.textContent = "";
    return;
  }
  captionTitle.textContent = c.title;
  captionMeta.textContent = String(c.photos.length);
  syncPresentationClass();
}

function presentCollection(index) {
  console.log("[presentCollection] index=" + index + ", collection=" + (collections[index]?.title || "?") + ", flippedId=" + collections[index]?.id);
  app.selectedIndex = index;
  app.targetPosition = index;
  app.flippedId = collections[index].id;
  app.presentationPhase = "scattering";
  app.presentationTimer = 0;
  app.lastTickTime = 0;
  clearTimeout(app.presentationTimeout);
  app.presentationTimeout = setTimeout(completeCasePresentation, CASE_PRESENT_MS + 80);
  updateCaption();
  emitBehavior("cd-open", { collectionId: collections[index]?.id, index });
}

function hidePresentation() {
  console.log("[hidePresentation] called, vinyl.phase=" + vinyl.phase + ", flippedId=" + app.flippedId + ", presentationPhase=" + app.presentationPhase + ", selectedIndex=" + app.selectedIndex);
  if (vinyl.phase !== VS_HIDDEN) {
    vinyl.phase = VS_HIDDEN;
    stopVinylLoop();
    vinylStage.classList.remove("active");
    stopInlineVideo();
    hidePlayIndicator();
    var btn = document.getElementById("detailEntryBtn");
    if (btn) btn.classList.remove("show");
  }
  clearTimeout(app.presentationTimeout);
  app.presentationTimeout = 0;
  restorePresentedCase();
  app.flippedId = null;
  app.presentationPhase = "idle";
  app.presentationTimer = 0;
  document.body.classList.remove("presenting");
  updateCaption();
  console.log("[hidePresentation] done, presentationPhase now idle");
}

function restorePresentedCase() {
  const group = app.groups[app.selectedIndex];
  console.log("[restorePresentedCase] selectedIndex=" + app.selectedIndex + ", group exists=" + !!group + ", groups.length=" + app.groups.length);
  if (!group) return;
  console.log("[restorePresentedCase] before restore - group.visible=" + group.visible + ", group.userData._faded=" + group.userData._faded + ", rotation.y=" + group.rotation.y);
  group.rotation.y = 0;
  group.userData._faded = false;
  group.userData._dimOpacity = 1;
  group.visible = true;
  if (group.userData.lidPivot) group.userData.lidPivot.rotation.y = 0;
  restoreGroupOpacity(group);
}

function syncPresentationClass() {
  const collection = collections[app.selectedIndex] || collections[0];
  const presenting = Boolean(app.flippedId && innerHeight >= innerWidth
    && (app.presentationPhase === "scattering" || app.presentationPhase === "presenting") && collection);
  document.body.classList.toggle("presenting", presenting);
  if (collection && albumTitleLayer) albumTitleLayer.querySelector("strong").textContent = collection.title;
  if (collection) updateTitlePlane(collection);
}

function renderDrawer(index) {
  const collection = collections[index] || collections[0];
  if (!collection) return;
  app.drawerIndex = index;
  emitBehavior("drawer-open", { collectionId: collection.id, photoCount: collection.photos.length });
  app.selectedPhotos.clear();
  drawerTitle.textContent = collection.title;
  drawerMeta.textContent = `${collection.photos.length} 张`;
  drawerGrid.replaceChildren();
  collection.photos.forEach((photo, photoIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `photo-thumb${photoIndex === app.drawerPhoto ? " active" : ""}`;
    button.dataset.photoIndex = String(photoIndex);
    button.style.backgroundImage = `url("${photoToThumb(photo)}")`;
    console.log("[renderDrawer] photo[" + photoIndex + "] name=" + photo.name + ", coverUrl=" + (photo.coverUrl || "none") + ", fallback set to: " + photoToThumb(photo));
    if (photo.coverUrl) {
      var img = new Image();
      img.onload = function() {
        console.log("[renderDrawer] cover loaded OK for photo[" + photoIndex + "]: " + photo.coverUrl);
        button.style.backgroundImage = `url("${photo.coverUrl}")`;
      };
      img.onerror = function(e) {
        console.error("[renderDrawer] cover FAILED for photo[" + photoIndex + "]: " + photo.coverUrl + " | error type=" + (e && e.type || "unknown"));
      };
      img.src = photo.coverUrl;
    }
    var label = document.createElement("span");
    label.textContent = getPhotoDrawerLabel(photo);
    button.append(label);
    drawerGrid.append(button);
  });
  photoDrawer.classList.add("open");
}

function getPhotoDrawerLabel(photo) {
  if (!photo) return "";
  if (app.currentCriterion === "location") return photo.locationLabel || "未知地点";
  if (app.currentCriterion === "time") return photo.timeLabel || "未知时间";
  return photo.paletteLabel;
}

function hideDrawer() {
  photoDrawer.classList.remove("open");
  app.selectedPhotos.clear();
}

function onDrawerClick(event) {
  const button = event.target.closest(".photo-thumb");
  if (!button) {
    hidePresentation();
    return;
  }
  const photoIndex = Number(button.dataset.photoIndex || 0);
  app.drawerPhoto = photoIndex;
  app.detailPhoto = app.drawerPhoto;

  var collection = collections[app.drawerIndex] || collections[0];
  var photo = collection && collection.photos ? collection.photos[photoIndex] : null;

  if (photo && photo.videoUrl) {
    openVideoPlayer(photo);
    return;
  }

  drawerGrid.querySelectorAll(".photo-thumb").forEach((item, index) => {
    item.classList.toggle("active", index === app.drawerPhoto);
  });
}

function onDrawerHover(event) {
  const button = event.target.closest(".photo-thumb");
  if (!button) return;
  const photoIndex = Number(button.dataset.photoIndex || 0);
  captionMeta.textContent = String(photoIndex + 1);
}

function openDetail(index) {
  app.detailCollection = index;
  app.detailPhoto = 0;
  hideDrawer();
  detail.classList.add("open");
  document.getElementById("hud").style.display = "none";
  drawDetail();
}

function closeDetail() {
  detail.classList.remove("open");
  document.getElementById("hud").style.display = "";
  app.flippedId = collections[app.detailCollection].id;
  if (innerHeight >= innerWidth) renderDrawer(app.detailCollection);
  updateCaption();
}

var currentVideo = { photo: null, playing: false, playlist: [], index: 0, swipeY: 0, swiping: false };

function buildVideoPlaylist(photo) {
  var genre = photo.paletteKey;
  var list = [];
  for (var ci = 0; ci < collections.length; ci++) {
    var c = collections[ci];
    for (var pi = 0; pi < c.photos.length; pi++) {
      var p = c.photos[pi];
      if (p.paletteKey === genre && p.videoUrl) list.push(p);
    }
  }
  return list;
}

function updateVideoProgress() {
  var el = document.getElementById("videoProgress");
  if (el && currentVideo.playlist.length > 1) {
    el.textContent = (currentVideo.index + 1) + " / " + currentVideo.playlist.length;
    el.style.display = "";
  } else if (el) {
    el.style.display = "none";
  }
}

function switchVideo(direction) {
  if (currentVideo.swiping) return;
  var list = currentVideo.playlist;
  if (list.length <= 1) return;
  currentVideo.swiping = true;

  var newIndex;
  if (direction === "next") {
    newIndex = (currentVideo.index + 1) % list.length;
  } else {
    newIndex = (currentVideo.index - 1 + list.length) % list.length;
  }

  var wrapper = document.getElementById("videoWrapper");
  var cls = direction === "next" ? "swipe-up" : "swipe-down";
  wrapper.classList.add(cls);

  wrapper.addEventListener("transitionend", function onEnd() {
    wrapper.removeEventListener("transitionend", onEnd);
    applyVideoPhoto(list[newIndex], newIndex);
    wrapper.classList.remove(cls);
    currentVideo.swiping = false;
  }, { once: true });
}

function applyVideoPhoto(photo, index) {
  currentVideo.photo = photo;
  currentVideo.index = index;

  var videoEl = document.getElementById("videoEl");
  document.getElementById("videoAuthor").textContent = photo.videoAuthor || "";
  document.getElementById("videoTitle").textContent = photo.videoTitle || "";
  document.getElementById("videoMusic").textContent = photo.videoMusic || "";
  document.getElementById("videoLikes").textContent = (photo.videoLikes || "0") + " 赞";
  document.getElementById("videoComments").textContent = (photo.videoComments || "0") + " 评论";
  document.getElementById("videoFavorites").textContent = (photo.videoFavorites || "0") + " 收藏";
  document.getElementById("videoShares").textContent = (photo.videoShares || "0") + " 分享";

  var tagsEl = document.getElementById("videoTags");
  tagsEl.replaceChildren();
  (photo.videoTags || []).forEach(function(t) {
    var span = document.createElement("span");
    span.textContent = t;
    tagsEl.appendChild(span);
  });

  updateVideoProgress();

  videoEl.src = photo.videoUrl;
  videoEl.load();
  videoEl.addEventListener("canplay", function onReady() {
    videoEl.removeEventListener("canplay", onReady);
    videoEl.play().catch(function() {});
    currentVideo.playing = true;
  }, { once: true });
}

function onVideoTouchStart(e) {
  if (e.touches.length !== 1) return;
  currentVideo.swipeY = e.touches[0].clientY;
}

function onVideoTouchEnd(e) {
  if (!currentVideo.swipeY) return;
  var dy = (e.changedTouches[0] || {}).clientY - currentVideo.swipeY;
  currentVideo.swipeY = 0;
  if (dy < -60) switchVideo("next");
  else if (dy > 60) switchVideo("prev");
}

function openVideoPlayer(photo) {
  if (!photo || !photo.videoUrl) return;

  currentVideo.playlist = buildVideoPlaylist(photo);
  currentVideo.index = currentVideo.playlist.indexOf(photo);
  if (currentVideo.index < 0) currentVideo.index = 0;

  var player = document.getElementById("videoPlayer");
  player.classList.add("open");
  hideDrawer();
  stopVinylLoop();
  stopInlineVideo();
  hidePlayIndicator();
  var btn = document.getElementById("detailEntryBtn");
  if (btn) btn.classList.remove("show");
  applyVideoPhoto(photo, currentVideo.index);
}

function closeVideoPlayer() {
  console.log("[closeVideoPlayer] presentationPhase=" + app.presentationPhase + ", vinyl.phase=" + vinyl.phase + ", flippedId=" + app.flippedId + ", selectedIndex=" + app.selectedIndex);
  var player = document.getElementById("videoPlayer");
  var videoEl = document.getElementById("videoEl");

  player.classList.remove("open");
  videoEl.pause();
  videoEl.removeAttribute("src");
  videoEl.load();
  currentVideo.photo = null;
  currentVideo.playing = false;

  if (app.presentationPhase === "presenting" && vinyl.phase === VS_CAROUSEL) {
    console.log("[closeVideoPlayer] restarting vinyl loop");
    startVinylLoop();
    var btn = document.getElementById("detailEntryBtn");
    var photo = vinyl.photos[vinyl.selectedIndex];
    if (btn && photo && photo.videoUrl) {
      btn.classList.add("show");
      showPlayIndicator();
    }
  }
  console.log("[closeVideoPlayer] done, presentationPhase=" + app.presentationPhase);
}

function toggleVideoPlayPause() {
  var videoEl = document.getElementById("videoEl");
  if (!videoEl.src) return;
  if (videoEl.paused) {
    videoEl.play().catch(function() {});
    currentVideo.playing = true;
  } else {
    videoEl.pause();
    currentVideo.playing = false;
  }
}

function syncInlineVideo() {
  var el = document.getElementById("inlineVideo");
  if (!el || !vinyl._previewRect || !el.classList.contains("show")) return;
  var r = vinyl._previewRect;
  el.style.left = r.x + "px";
  el.style.top = r.y + "px";
  el.style.width = r.w + "px";
  el.style.height = r.h + "px";
}

function syncDetailEntryButton() {
  var btn = document.getElementById("detailEntryBtn");
  if (!btn || !btn.classList.contains("show") || !vinyl._previewRect) return;
  var r = vinyl._previewRect;
  var discTop = vinyl.vinylY - vinyl.vinylR + 42;
  var ringTop = vinyl.vinylY - vinyl.ringR + 72;
  var y = Math.max(r.y + r.h + 28, Math.min(ringTop, discTop + 34));
  if (innerWidth > innerHeight) y += 18;
  else y += 18;
  btn.style.left = (r.x + r.w / 2) + "px";
  btn.style.top = y + "px";
}

function syncPlayIndicator() {
  var el = document.getElementById("playIndicator");
  if (!el || !vinyl._previewRect || !el.classList.contains("show")) return;
  var r = vinyl._previewRect;
  el.style.left = (r.x + r.w / 2) + "px";
  el.style.top = (r.y + r.h / 2) + "px";
}

function showPlayIndicator() {
  var el = document.getElementById("playIndicator");
  if (!el) return;
  var photo = vinyl.photos[vinyl.selectedIndex];
  if (!photo || !photo.videoUrl) return;
  var inlineVid = document.getElementById("inlineVideo");
  if (inlineVid && inlineVid.classList.contains("show") && !inlineVid.paused) return;
  syncPlayIndicator();
  el.classList.add("show");
}

function hidePlayIndicator() {
  var el = document.getElementById("playIndicator");
  if (el) el.classList.remove("show");
}

function pointInRect(x, y, rect, pad) {
  if (!rect) return false;
  var p = pad || 0;
  return x >= rect.x - p && x <= rect.x + rect.w + p &&
    y >= rect.y - p && y <= rect.y + rect.h + p;
}

function getVinylHitZone(e) {
  if (vinyl.phase !== VS_CAROUSEL) return "none";
  if (pointInRect(e.clientX, e.clientY, vinyl._previewRect, 4)) return "preview";
  var wheelTop = vinyl.vinylY - vinyl.ringR - 56;
  if (e.clientY >= wheelTop) return "wheel";
  return "blank";
}

function playInlineVideo(photo) {
  if (!photo || !photo.videoUrl) return;
  var el = document.getElementById("inlineVideo");
  if (!el) return;
  if (el.src && !el.paused) {
    el.pause();
    showPlayIndicator();
    triggerTonearmLift();
    return;
  }
  if (el.src) {
    el.play().catch(function() {});
    hidePlayIndicator();
    vinyl.tonearmTargetLift = 0;
    return;
  }
  syncInlineVideo();
  el.src = photo.videoUrl;
  el.classList.add("show");
  hidePlayIndicator();
  vinyl.tonearmTargetLift = 0;
  el.play().catch(function() {});
}

function stopInlineVideo() {
  var el = document.getElementById("inlineVideo");
  if (!el) return;
  el.pause();
  el.removeAttribute("src");
  el.load();
  el.classList.remove("show");
  showPlayIndicator();
  triggerTonearmLift();
}

function buildCollections(criterion) {
  const groups = new Map();
  const filtered = allPhotos.filter((photo) => (photo.criterionSource || "palette") === criterion);
  filtered.forEach((photo) => {
    const groupInfo = classifyPhoto(photo, criterion);
    if (!groups.has(groupInfo.key)) {
      groups.set(groupInfo.key, {
        info: groupInfo,
        photos: []
      });
    }
    groups.get(groupInfo.key).photos.push(photo);
  });

  return Array.from(groups.values())
    .sort((a, b) => String(a.info.sortValue).localeCompare(String(b.info.sortValue), "zh-Hans-CN"))
    .map(({ info, photos }) => {
      const manualPalette = photos[0]?.manualGroupByCriterion?.[criterion];
      let palette;
      if (manualPalette && manualPalette.primary) {
        palette = { primary: manualPalette.primary, secondary: manualPalette.secondary, text: manualPalette.text, coverUrl: manualPalette.coverUrl };
      } else {
        palette = makeAdaptivePalette(photos[0]?.dominantColor || "#8a6a55");
      }
      return makeCollection(info.key, info.title, info.spine, palette, photos, criterion);
    });
}

function regroupCollections(criterion, preferredCollectionId = null, presentAfter = false) {
  const previousId = preferredCollectionId || collections[app.selectedIndex]?.id;
  disposeCaseGroups();
  collections = buildCollections(criterion);
  app.groups = collections.map((collection, index) => createCaseGroup(collection, index));
  const nextIndex = Math.max(0, collections.findIndex((collection) => collection.id === previousId));
  app.selectedIndex = clamp(nextIndex, 0, Math.max(collections.length - 1, 0));
  app.targetPosition = app.selectedIndex;
  app.shelfPosition = app.selectedIndex;
  app.flippedId = presentAfter ? collections[app.selectedIndex]?.id || null : null;
  app.drawerPhoto = 0;
  app.detailPhoto = 0;
  if (app.flippedId && innerHeight >= innerWidth) renderDrawer(app.selectedIndex);
  else hideDrawer();
  updateCaption();
}

function disposeCaseGroups() {
  console.log("[disposeCaseGroups] disposing " + app.groups.length + " groups");
  app.groups.forEach((group) => {
    app.scene.remove(group);
    group.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((material) => {
        if (material.map) console.log("[disposeCaseGroups] disposing texture map, uuid=" + material.map.uuid);
        material.map?.dispose();
        material.dispose?.();
      });
    });
  });
  app.groups = [];
}

function drawDetail() {
  if (!app.detailCtx || !detail.classList.contains("open")) return;
  const ctx = app.detailCtx;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(320, innerWidth || 320);
  const h = Math.max(320, innerHeight || 640);
  detailCanvas.width = w * dpr;
  detailCanvas.height = h * dpr;
  detailCanvas.style.width = `${w}px`;
  detailCanvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const collection = collections[app.detailCollection];
  const photo = collection.photos[app.detailPhoto] || collection.photos[0];
  const portrait = h >= w;
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, w, h);
  if (!photo) return;
  if (portrait) {
    const panelH = Math.max(270, h * 0.38);
    ctx.fillStyle = collection.palette.primary;
    ctx.fillRect(0, 0, w, panelH);
    ctx.fillStyle = "rgba(0,0,0,.14)";
    for (let y = 30; y < panelH; y += 42) ctx.fillRect(0, y, w, 1);
    text(ctx, "CHAPTER " + String(app.detailCollection + 1).padStart(2, "0") + " · CONTACT SHEET", 28, 52, 10, "rgba(20,10,8,.56)", 900);
    text(ctx, collection.title, 28, 128, clamp(w * 0.16, 50, 76), "#120908", 900, "left", "Impact, Arial Black");
    drawCoverImage(ctx, photo.source, 0, panelH, w, h - panelH - 104);
    drawPhotoMeta(ctx, photo, 0, panelH, w, h - panelH - 104);
    drawStrip(ctx, collection, 0, h - 104, w, 104);
  } else {
    const leftW = w * 0.42;
    ctx.fillStyle = collection.palette.primary;
    ctx.fillRect(0, 0, leftW, h);
    text(ctx, "CHAPTER " + String(app.detailCollection + 1).padStart(2, "0"), 34, 76, 11, "rgba(20,10,8,.56)", 900);
    text(ctx, collection.title, 34, 160, clamp(leftW * 0.18, 52, 90), "#120908", 900, "left", "Impact, Arial Black");
    drawCoverImage(ctx, photo.source, leftW, 0, w - leftW, h);
    drawPhotoMeta(ctx, photo, leftW, 0, w - leftW, h);
  }
}

function drawPhotoMeta(ctx, photo, x, y, w, h) {
  text(ctx, photo.name, x + 26, y + h - 68, 22, "#fff8ec", 900, "left", "Georgia");
  text(ctx, String(app.detailPhoto + 1).padStart(2, "0"), x + w - 24, y + h - 36, clamp(w * .12, 48, 86), "rgba(255,248,236,.92)", 900, "right", "Impact");
}

function initVinylStage() {
  vinylStage.classList.add("active");
  resizeVinyl();
}

function resizeVinyl() {
  const w = Math.max(320, innerWidth || 320);
  const h = Math.max(320, innerHeight || 640);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  vinyl.w = w; vinyl.h = h;
  vinylStage.width = w * dpr;
  vinylStage.height = h * dpr;
  vinylStage.style.width = w + "px";
  vinylStage.style.height = h + "px";
  vinylCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  vinyl.cx = w / 2;
  vinyl.vinylR = clamp(w * 0.8, 292, h * 0.5);
  vinyl.cy = h + vinyl.vinylR * 0.28;
  vinyl.ringR = vinyl.vinylR * 0.88;
  vinyl.vinylTargetY = vinyl.cy;
  vinyl.dpr = dpr;
}

function VinylCarousel(ctx, now, dt) {
  updateVinylMotion(dt, now);
  PhotoPreview(ctx, now);
  drawVinylDisc(ctx, vinyl.cx, vinyl.vinylY, vinyl.vinylR, vinyl.angle, vinyl.palette || { primary: "#c74731", secondary: "#1c0c08", text: "#fff0c8" }, vinyl.collectionId);
  drawTonearm(ctx);
  ArcWheel(ctx);
  drawVinylChrome(ctx);
}

function updateVinylMotion(dt, now) {
  if (vinyl.phase !== VS_CAROUSEL) return;
  const maxPosition = Math.max(vinyl.photos.length - 1, 0);
  if (!vinyl.dragging) {
    if (Math.abs(vinyl.dragVelocity) > 0.003) {
      vinyl.position += vinyl.dragVelocity * dt;
      vinyl.dragVelocity *= Math.pow(0.91, dt);
      if (vinyl.position < 0 || vinyl.position > maxPosition) vinyl.dragVelocity *= 0.45;
      vinyl.position = rubberClamp(vinyl.position, 0, maxPosition, 0.22);
      if (Math.abs(vinyl.dragVelocity) < 0.012) {
        vinyl.dragVelocity = 0;
        vinyl.targetPosition = clamp(Math.round(vinyl.position), 0, maxPosition);
      }
    }
    const pull = vinyl.targetPosition - vinyl.position;
    vinyl.positionVelocity += pull * 0.045 * dt;
    vinyl.positionVelocity *= Math.pow(0.72, dt);
    vinyl.position += vinyl.positionVelocity * dt;
    if (Math.abs(pull) < 0.001 && Math.abs(vinyl.positionVelocity) < 0.001) {
      vinyl.position = vinyl.targetPosition;
      vinyl.positionVelocity = 0;
    }
  }
  vinyl.position = clamp(vinyl.position, 0, maxPosition);
  vinyl.angle = -vinyl.position * ARC_ANGLE_STEP;
  setVinylSelected(clamp(Math.round(vinyl.position), 0, maxPosition), now);

  var liftPull = vinyl.tonearmTargetLift - vinyl.tonearmLift;
  vinyl.tonearmLiftVel += liftPull * 0.12 * dt;
  vinyl.tonearmLiftVel *= Math.pow(0.55, dt);
  vinyl.tonearmLift += vinyl.tonearmLiftVel * dt;
  if (Math.abs(liftPull) < 0.05 && Math.abs(vinyl.tonearmLiftVel) < 0.05) {
    vinyl.tonearmLift = vinyl.tonearmTargetLift;
    vinyl.tonearmLiftVel = 0;
  }
}

function setVinylSelected(index, now) {
  if (index === vinyl.selectedIndex) return;
  vinyl.previewFromIndex = vinyl.selectedIndex;
  vinyl.previousIndex = vinyl.selectedIndex;
  vinyl.selectedIndex = index;
  vinyl.previewStartedAt = now;
  stopInlineVideo();
  var btn = document.getElementById("detailEntryBtn");
  if (btn && vinyl.phase === VS_CAROUSEL) {
    var photo = vinyl.photos[index];
    if (photo && photo.videoUrl) btn.classList.add("show");
    else btn.classList.remove("show");
  }
}

function PhotoPreview(ctx, now) {
  const photo = vinyl.photos[vinyl.selectedIndex];
  if (!photo) return;
  const fromPhoto = vinyl.photos[vinyl.previewFromIndex] || photo;
  const topLimit = Math.max(250, vinyl.vinylY - vinyl.ringR - 92);
  const bgColor = photo.dominantColor || vinyl.palette?.primary || "#1f1b18";

  const bg = ctx.createLinearGradient(0, 0, 0, vinyl.h);
  bg.addColorStop(0, tintHex(bgColor, 0.14, 0.88));
  bg.addColorStop(0.42, "rgba(8,7,7,0.9)");
  bg.addColorStop(1, "#020202");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, vinyl.w, vinyl.h);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.filter = "blur(34px)";
  var previewSource = photo._coverImg || photo.source;
  drawCoverImage(ctx, previewSource, -vinyl.w * 0.18, -vinyl.h * 0.05, vinyl.w * 1.36, topLimit * 0.9);
  ctx.restore();

  const progress = clamp((now - vinyl.previewStartedAt) / PREVIEW_TRANSITION_MS, 0, 1);
  const ease = springEase(progress);
  if (fromPhoto !== photo && progress < 1) drawPreviewImage(ctx, fromPhoto, topLimit, 1 - ease, 1 + ease * 0.018, -8 * ease);
  drawPreviewImage(ctx, photo, topLimit, ease, 0.965 + ease * 0.035, 16 * (1 - ease));

  ctx.save();
  ctx.fillStyle = "rgba(255,248,232,.72)";
  ctx.font = "800 11px Arial, PingFang SC, sans-serif";
  ctx.textAlign = "center";
  var counterY = Math.min(vinyl.h - 126, topLimit + 26);
  ctx.fillText(
    String(vinyl.selectedIndex + 1).padStart(2, "0") + " / " + String(vinyl.photos.length).padStart(2, "0"),
    vinyl.w / 2,
    counterY
  );
  ctx.restore();

  var tags = photo.videoTags || [];
  if (tags.length > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(ease, 0, 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = "11px Arial, PingFang SC, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    var tagY = counterY - 10;
    var maxW = vinyl.w - 48;
    var tagLine = tags.join("  ");
    var metrics = ctx.measureText(tagLine);
    if (metrics.width > maxW) {
      var trimmed = "";
      for (var ti = 0; ti < tags.length; ti++) {
        var test = trimmed ? trimmed + "  " + tags[ti] : tags[ti];
        if (ctx.measureText(test).width > maxW) break;
        trimmed = test;
      }
      tagLine = trimmed;
    }
    ctx.fillText(tagLine, vinyl.w / 2, tagY);
    ctx.restore();
  }
}

function drawPreviewImage(ctx, photo, areaH, alpha, scale, translateY) {
  const margin = Math.max(24, vinyl.w * 0.07);
  const maxW = vinyl.w - margin * 2;
  const maxH = Math.max(190, areaH - 78);
  const src = photo._coverImg || photo.source;
  const sw = src.width || 480;
  const sh = src.height || 640;
  const ratio = sw / sh;
  let dw, dh;
  if (maxW / maxH > ratio) { dh = maxH; dw = dh * ratio; }
  else { dw = maxW; dh = dw / ratio; }
  dw *= scale;
  dh *= scale;
  const px = (vinyl.w - dw) / 2;
  const py = Math.max(54, (areaH - dh) / 2) + translateY;

  if (alpha > 0.5) {
    vinyl._previewRect = { x: px, y: py, w: dw, h: dh };
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 16;
  ctx.beginPath();
  roundRect(ctx, px, py, dw, dh, 10);
  ctx.fillStyle = "#111";
  ctx.fill();
  ctx.clip();
  ctx.filter = alpha < 0.98 ? "blur(" + ((1 - alpha) * 5).toFixed(2) + "px)" : "none";
  drawCoverImage(ctx, src, px, py, dw, dh);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  roundRect(ctx, px, py, dw, dh, 10);
  ctx.stroke();
  ctx.restore();

  if (photo && alpha > 0.85) {
    var captionH = Math.max(28, dh * 0.13);
    var captionY = py + dh - captionH;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    roundRect(ctx, px, captionY, dw, captionH, 0);
    ctx.clip();
    var capGrad = ctx.createLinearGradient(0, captionY, 0, py + dh);
    capGrad.addColorStop(0, "rgba(0,0,0,0)");
    capGrad.addColorStop(1, "rgba(0,0,0,.68)");
    ctx.fillStyle = capGrad;
    ctx.fillRect(px, captionY, dw, captionH);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,.8)";
    ctx.shadowBlur = 3;
    ctx.font = "700 " + Math.max(9, captionH * 0.35) + "px Arial, PingFang SC, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(truncateText(photo.videoAuthor || "", 16), px + 8, py + dh - 6);
    var likesText = (photo.videoLikes || "0") + " 赞";
    ctx.textAlign = "right";
    ctx.fillText(likesText, px + dw - 8, py + dh - 6);
    ctx.restore();
  }
}

function drawVinylDisc(ctx, cx, cy, r, angle, palette, collectionId) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle * 0.24);

  ctx.beginPath(); ctx.arc(0, 0, r + 12, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.46)"; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  const discGrad = ctx.createRadialGradient(-r * 0.16, -r * 0.28, r * 0.08, 0, 0, r);
  discGrad.addColorStop(0, "#3a3631");
  discGrad.addColorStop(0.34, "#242220");
  discGrad.addColorStop(0.7, "#141414");
  discGrad.addColorStop(1, "#070707");
  ctx.fillStyle = discGrad; ctx.fill();

  for (let i = 0; i < 44; i += 1) {
    const gr = r * (0.16 + i * 0.019);
    ctx.beginPath(); ctx.arc(0, 0, gr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255," + (i % 4 === 0 ? 0.058 : 0.024) + ")";
    ctx.lineWidth = i % 5 === 0 ? 0.9 : 0.45; ctx.stroke();
  }

  const labelR = r * 0.31;
  ctx.beginPath(); ctx.arc(0, 0, labelR, 0, Math.PI * 2);
  ctx.fillStyle = palette.primary; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, labelR * 0.92, 0, Math.PI * 2);
  const labelGrad = ctx.createRadialGradient(-labelR * 0.3, -labelR * 0.36, labelR * 0.08, 0, 0, labelR * 0.94);
  labelGrad.addColorStop(0, tintHex(palette.primary, 1, 1.36));
  labelGrad.addColorStop(0.58, palette.primary);
  labelGrad.addColorStop(1, palette.secondary);
  ctx.fillStyle = labelGrad; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, labelR * 0.92, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = tintHex(palette.text, 0.96, 1);
  ctx.font = "800 " + (labelR * 0.34) + "px Impact, Arial Black, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("B-SIDE", 0, -labelR * 0.16);
  ctx.font = "700 " + (labelR * 0.24) + "px Arial, sans-serif";
  ctx.fillStyle = "rgba(255,248,232,.78)";
  ctx.fillText("MUSIC 2026", 0, labelR * 0.28);
  ctx.restore();

  var genreRingColors = {
    "jazz": "#c8922a",
    "hiphop": "#e8e4dc",
    "rnb": "#9c6fd6",
    "electronic": "#4fc3f7",
    "folk": "#8b6f47",
    "cinematic": "#78909c"
  };
  var col = collections.find(function(c) { return c.id === collectionId; });
  var genreKey = col ? col.id : "";
  var ringColor = genreRingColors[genreKey] || "#8b1a2b";
  var ringR = labelR * 1.0;
  ctx.beginPath(); ctx.arc(0, 0, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 6;
  ctx.stroke();

  const shine = ctx.createLinearGradient(-r * 0.72, -r * 0.78, r * 0.75, r * 0.3);
  shine.addColorStop(0, "rgba(255,255,255,0)");
  shine.addColorStop(0.4, "rgba(255,255,255,.058)");
  shine.addColorStop(0.5, "rgba(255,255,255,.18)");
  shine.addColorStop(0.6, "rgba(255,255,255,.044)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = shine; ctx.fill();
  ctx.restore();
}

function triggerTonearmLift() {
  vinyl.tonearmTargetLift = -12;
  clearTimeout(vinyl._tonearmTimer);
  vinyl._tonearmTimer = setTimeout(function() {
    vinyl.tonearmTargetLift = 0;
  }, 300);
}

function drawTonearm(ctx) {
  var discCX = vinyl.cx;
  var discCY = vinyl.vinylY;
  var ringR = vinyl.vinylR * 0.31;
  var lift = vinyl.tonearmLift || 0;

  var pivotX = vinyl.w * 0.84;
  var pivotY = discCY - vinyl.vinylR * 0.58;

  var dx = discCX - pivotX;
  var dy = discCY - pivotY;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;

  var stylusX = discCX - (dx / dist) * ringR;
  var stylusY = discCY - (dy / dist) * ringR + lift;

  var ux = dx / dist;
  var uy = dy / dist;

  ctx.save();

  // Pivot base shadow
  ctx.beginPath();
  ctx.arc(pivotX, pivotY + 1, 8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fill();

  // Pivot base
  var baseGrad = ctx.createRadialGradient(pivotX - 2, pivotY - 2, 1, pivotX, pivotY, 8);
  baseGrad.addColorStop(0, "#4a4a4a");
  baseGrad.addColorStop(1, "#222");
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, 8, 0, Math.PI * 2);
  ctx.fillStyle = baseGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Inner pivot screw
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#666";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.3)";
  ctx.lineWidth = 0.6;
  ctx.stroke();

  // Tonearm shadow
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY + 2);
  ctx.lineTo(stylusX, stylusY + 2);
  ctx.strokeStyle = "rgba(0,0,0,.18)";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Tonearm rod with metallic gradient
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(stylusX, stylusY);
  var armGrad = ctx.createLinearGradient(pivotX, pivotY, stylusX, stylusY);
  armGrad.addColorStop(0, "#d8d8d8");
  armGrad.addColorStop(0.25, "#eaeaec");
  armGrad.addColorStop(0.5, "#c0c0c0");
  armGrad.addColorStop(0.75, "#d4d4d4");
  armGrad.addColorStop(1, "#a8a8a8");
  ctx.strokeStyle = armGrad;
  ctx.lineWidth = 3.2;
  ctx.shadowColor = "rgba(0,0,0,.25)";
  ctx.shadowBlur = 3;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // Stylus head housing
  var hx = stylusX + ux * 8;
  var hy = stylusY + uy * 8;
  ctx.beginPath();
  ctx.moveTo(stylusX, stylusY);
  ctx.lineTo(hx, hy);
  ctx.strokeStyle = "#b8b8b8";
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Stylus cantilever
  var sx = hx + ux * 4;
  var sy = hy + uy * 4;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(sx, sy);
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Stylus tip
  ctx.beginPath();
  ctx.arc(sx, sy, 1, 0, Math.PI * 2);
  ctx.fillStyle = "#777";
  ctx.fill();

  ctx.restore();
}

function ArcWheel(ctx) {
  const cx = vinyl.cx, cy = vinyl.vinylY, ringR = vinyl.ringR;
  const thumbs = vinyl.thumbs;
  if (!thumbs.length) return;
  const visible = [];

  for (let i = 0; i < thumbs.length; i += 1) {
    const offset = i - vinyl.position;
    const angle = offset * ARC_ANGLE_STEP;
    if (Math.abs(angle) > 1.55) continue;
    const absOffset = Math.abs(offset);
    const focus = clamp(1 - absOffset / 4.25, 0, 1);
    visible.push({ i, offset, angle, focus });
  }

  visible.sort((a, b) => a.focus - b.focus);

  visible.forEach((item) => drawArcThumbnail(ctx, item));
  drawArcGuide(ctx, cx, cy, ringR);
}

function drawArcGuide(ctx, cx, cy, radius) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius + 5, -Math.PI * 0.81, -Math.PI * 0.19);
  ctx.strokeStyle = "rgba(255,255,255,.14)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, radius - 52, -Math.PI * 0.79, -Math.PI * 0.21);
  ctx.strokeStyle = "rgba(0,0,0,.34)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, radius, -Math.PI / 2 - 0.11, -Math.PI / 2 + 0.11);
  ctx.strokeStyle = "rgba(255,248,226,.58)";
  ctx.lineWidth = 3;
  ctx.shadowColor = "rgba(255,255,255,.32)";
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.restore();
}

function drawArcThumbnail(ctx, item) {
  const thumb = vinyl.thumbs[item.i];
  const photo = vinyl.photos[item.i];
  const photoSource = (photo && photo._coverImg) || (photo && photo.source) || thumb;
  const angle = item.angle;
  const absOffset = Math.abs(item.offset);
  const focus = smooth01(item.focus);
  const opacity = 0.5 + focus * 0.5;
  const centerTheta = angle - Math.PI / 2;
  const half = ARC_ANGLE_STEP * (0.42 + focus * 0.16);
  const outerR = vinyl.ringR + 34 + focus * 12;
  const innerR = outerR - (46 + focus * 34);
  const thetaA = centerTheta - half;
  const thetaB = centerTheta + half;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.filter = "none";
  if (focus > 0.42) {
    ctx.shadowColor = "rgba(255,255,255," + (0.24 * focus).toFixed(2) + ")";
    ctx.shadowBlur = 20 * focus;
  }
  drawArcSlicePath(ctx, vinyl.cx, vinyl.vinylY, innerR, outerR, thetaA, thetaB);
  ctx.clip();
  const midR = (innerR + outerR) / 2;
  const midX = vinyl.cx + Math.cos(centerTheta) * midR;
  const midY = vinyl.vinylY + Math.sin(centerTheta) * midR;
  const boxW = Math.max(86, (outerR - innerR) * 2.45);
  const boxH = Math.max(72, outerR * (thetaB - thetaA) * 1.55);
  ctx.translate(midX, midY);
  ctx.rotate(angle * 0.64);
  ctx.beginPath();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (photoSource) drawCoverImage(ctx, photoSource, -boxW / 2, -boxH / 2, boxW, boxH);
  else {
    ctx.fillStyle = "#181512";
    ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = clamp(opacity + 0.08, 0, 1);
  ctx.strokeStyle = absOffset < 0.5 ? "rgba(255,246,226,.96)" : "rgba(255,255,255,.16)";
  ctx.lineWidth = absOffset < 0.5 ? 2.2 : 0.8;
  drawArcSlicePath(ctx, vinyl.cx, vinyl.vinylY, innerR, outerR, thetaA, thetaB);
  ctx.stroke();
  ctx.restore();

}

function drawArcSlicePath(ctx, cx, cy, innerR, outerR, thetaA, thetaB) {
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, thetaA, thetaB, false);
  ctx.arc(cx, cy, innerR, thetaB, thetaA, true);
  ctx.closePath();
}

function drawVinylChrome(ctx) {
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, 0, vinyl.h);
  grad.addColorStop(0, "rgba(0,0,0,.28)");
  grad.addColorStop(0.18, "rgba(0,0,0,0)");
  grad.addColorStop(0.78, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,.66)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, vinyl.w, vinyl.h);
  ctx.fillStyle = "rgba(255,248,232,.54)";
  ctx.font = "700 11px Arial, PingFang SC, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("轻触空白返回", vinyl.w / 2, 28);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function tickVinyl() {
  if (vinyl.phase === VS_HIDDEN) { stopVinylLoop(); return; }
  vinyl.animFrame = requestAnimationFrame(tickVinyl);
  const ctx = vinylCtx;
  const w = vinyl.w, h = vinyl.h;
  const now = performance.now();
  const dt = clamp((now - (vinyl.lastFrameTime || now)) / 16.67, 0.6, 2.2);
  vinyl.lastFrameTime = now;

  if (vinyl.phase === VS_SLIDEUP) {
    const elapsed = now - vinyl.timer;
    const t = Math.min(elapsed / VINYL_SLIDEUP_MS, 1);
    const ease = springEase(t);
    vinyl.vinylY = h + vinyl.vinylR * 1.1 - ease * (h + vinyl.vinylR * 1.1 - vinyl.vinylTargetY);
    if (t >= 1) { enterCarousel(); }
  }

  ctx.clearRect(0, 0, w, h);
  VinylCarousel(ctx, now, dt);
  syncInlineVideo();
  syncDetailEntryButton();
  syncPlayIndicator();
}

function startVinylLoop() {
  if (!vinyl.animating) {
    vinyl.animating = true;
    tickVinyl();
  }
}

function stopVinylLoop() {
  vinyl.animating = false;
  cancelAnimationFrame(vinyl.animFrame);
}

function enterCarousel() {
  vinyl.phase = VS_CAROUSEL;
  vinyl.dragVelocity = 0;
  vinyl.targetPosition = vinyl.position;
  vinyl.lastFrameTime = performance.now();
  var photo = vinyl.photos[vinyl.selectedIndex];
  var btn = document.getElementById("detailEntryBtn");
  if (btn && photo && photo.videoUrl) {
    btn.classList.add("show");
    showPlayIndicator();
  }
}

function snapCarousel() {
  const n = vinyl.photos.length;
  let idx = Math.round(vinyl.position);
  idx = clamp(idx, 0, n - 1);
  vinyl.selectedIndex = idx;
  vinyl.targetPosition = idx;
}

function useInertiaDrag(e, phase) {
  if (phase === "start") {
    vinyl.dragging = true;
    vinyl.dragVelocity = 0;
    vinyl.positionVelocity = 0;
    vinyl.dragStartX = e.clientX;
    vinyl.dragStartPosition = vinyl.position;
    vinyl.dragLastX = e.clientX;
    vinyl.dragLastTime = performance.now();
    vinyl.targetPosition = vinyl.position;
    vinylStage.setPointerCapture?.(e.pointerId);
    return;
  }
  if (phase === "move") {
    const now = performance.now();
    const dx = e.clientX - vinyl.dragStartX;
    const itemWidth = clamp(vinyl.w * 0.23, 78, 116);
    const next = vinyl.dragStartPosition - dx / itemWidth;
    vinyl.position = rubberClamp(next, 0, Math.max(vinyl.photos.length - 1, 0), 0.24);
    const dt = Math.max(now - vinyl.dragLastTime, 8);
    vinyl.dragVelocity = -((e.clientX - vinyl.dragLastX) / itemWidth) / (dt / 16.67);
    vinyl.dragLastX = e.clientX;
    vinyl.dragLastTime = now;
    setVinylSelected(clamp(Math.round(vinyl.position), 0, Math.max(vinyl.photos.length - 1, 0)), now);
    return;
  }
  if (phase === "end") {
    vinyl.dragging = false;
    vinyl.positionVelocity = vinyl.dragVelocity * 0.18;
    vinyl.targetPosition = clamp(Math.round(vinyl.position + vinyl.dragVelocity * 5.5), 0, Math.max(vinyl.photos.length - 1, 0));
  }
}

function onVinylPointerDown(e) {
  if (vinyl.phase !== VS_CAROUSEL) return;
  var zone = getVinylHitZone(e);
  if (zone === "blank") { hidePresentation(); return; }
  e.preventDefault();
  vinyl._tapStartX = e.clientX;
  vinyl._tapStartY = e.clientY;
  vinyl._tapStartTime = performance.now();
  vinyl._tapMoved = false;
  vinyl._tapZone = zone;
  useInertiaDrag(e, "start");
}

function onVinylPointerMove(e) {
  if (!vinyl.dragging) return;
  e.preventDefault();
  if (Math.abs(e.clientX - (vinyl._tapStartX || 0)) > 8 ||
      Math.abs(e.clientY - (vinyl._tapStartY || 0)) > 8) {
    vinyl._tapMoved = true;
  }
  useInertiaDrag(e, "move");
}

function onVinylPointerUp(e) {
  if (!vinyl.dragging) return;
  e.preventDefault();
  useInertiaDrag(e, "end");

  var dt = performance.now() - (vinyl._tapStartTime || 0);
  if (!vinyl._tapMoved && dt < 400 && vinyl._tapZone === "preview") {
    var photo = vinyl.photos[vinyl.selectedIndex];
    if (photo && photo.videoUrl) {
      playInlineVideo(photo);
      vinyl._lastVideoOpen = performance.now();
    }
  }
}

function onVinylClick(e) {
  if (vinyl.phase !== VS_CAROUSEL) return;
  var zone = getVinylHitZone(e);
  if (zone === "blank") { hidePresentation(); return; }
  if (zone !== "preview") return;
  var now = performance.now();
  if (now - (vinyl._lastVideoOpen || 0) < 500) return;
  var photo = vinyl.photos[vinyl.selectedIndex];
  if (photo && photo.videoUrl) {
    console.log("[onVinylClick] playing inline video for", photo.name);
    playInlineVideo(photo);
  }
}

function springEase(t) {
  const x = clamp(t, 0, 1);
  return 1 - Math.exp(-6.5 * x) * Math.cos(8.5 * x);
}

function smooth01(value) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function tintHex(hex, alpha = 1, lift = 1) {
  const rgb = parseHexColor(hex);
  return `rgba(${Math.round(rgb.r * lift)},${Math.round(rgb.g * lift)},${Math.round(rgb.b * lift)},${alpha})`;
}

function parseHexColor(hex) {
  const clean = String(hex || "#1f1b18").replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean, 16);
  if (Number.isNaN(value)) return { r: 31, g: 27, b: 24 };
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

async function restoreSavedLibrary() {
  try {
    const saved = await readStoredLibrary();
    if (!saved?.photos?.length) return false;
    const restored = [];
    for (const item of saved.photos.slice(0, 60)) {
      if (!item.storedDataUrl) continue;
      const source = await dataUrlToCanvasSource(item.storedDataUrl);
      restored.push({
        ...item,
        source,
        thumbUrl: ""
      });
    }
    if (!restored.length) return false;
    allPhotos = restored;
    app.currentCriterion = ["palette", "location", "time"].includes(saved.currentCriterion) ? saved.currentCriterion : "palette";
    return true;
  } catch (err) {
    console.warn("Saved library restore failed", err);
    await removeStoredLibrary();
    return false;
  }
}

function readStoredLibrary() {
  return withLibraryStore("readonly", (store) => requestToPromise(store.get(STORAGE_KEY)))
    .catch(() => {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    });
}

async function removeStoredLibrary() {
  localStorage.removeItem(STORAGE_KEY);
  try {
    await withLibraryStore("readwrite", (store) => requestToPromise(store.delete(STORAGE_KEY)));
  } catch {
    // localStorage fallback has already been cleared.
  }
}

function withLibraryStore(mode, action) {
  if (!("indexedDB" in globalThis)) return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    open.onerror = () => reject(open.error || new Error("IndexedDB open failed"));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(DB_STORE, mode);
      const store = tx.objectStore(DB_STORE);
      Promise.resolve(action(store))
        .then((value) => {
          tx.oncomplete = () => {
            db.close();
            resolve(value);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error || new Error("IndexedDB transaction failed"));
          };
        })
        .catch((err) => {
          db.close();
          reject(err);
        });
    };
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function rebuildCase(collection) {
  const index = collections.findIndex((c) => c.id === collection.id);
  if (index < 0 || !app.groups[index]) return;
  const old = app.groups[index];
  app.scene.remove(old);
  old.traverse((child) => {
    if (child.isMesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
  app.groups[index] = createCaseGroup(collection, index);
}

function normalizeImageSource(source) {
  const maxSide = 1800;
  const sw = source.width || 1;
  const sh = source.height || 1;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function dataUrlToCanvasSource(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      try {
        resolve(normalizeImageSource(image));
      } catch (err) {
        reject(err);
      }
    }, { once: true });
    image.addEventListener("error", () => reject(new Error("saved image decode failed")), { once: true });
    image.src = dataUrl;
  });
}

function drawCoverImage(ctx, source, x, y, w, h) {
  const sw = source.width || 480;
  const sh = source.height || 640;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function photoToThumb(photo) {
  if (photo.thumbUrl) return photo.thumbUrl;
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#17120e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawCoverImage(ctx, photo.source, 0, 0, canvas.width, canvas.height);
  photo.thumbUrl = canvas.toDataURL("image/jpeg", 0.74);
  return photo.thumbUrl;
}

function text(ctx, value, x, y, size, color, weight = 400, align = "left", family = "Arial") {
  ctx.font = `${weight} ${size}px ${family}, "PingFang SC", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}

function truncateText(str, maxLen) {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

function formatCount(n) {
  if (n == null) return "0";
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "w";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rubberClamp(value, min, max, strength) {
  if (value < min) return min + (value - min) * strength;
  if (value > max) return max + (value - max) * strength;
  return value;
}

function showError(err) {
  cancelAnimationFrame(app.frame);
  errorEl.textContent = err?.message || ERROR_TEXT;
  errorEl.classList.add("show");
  console.error(err);
}

boot();
