import * as THREE from "./three.module.min.js";

const ERROR_TEXT = "哎呀，出错了，请重启试试吧~";
const sceneCanvas = document.getElementById("scene");
const detail = document.getElementById("detail");
const detailCanvas = document.getElementById("detailCanvas");
const importBtn = document.getElementById("importBtn");
const backBtn = document.getElementById("backBtn");
const filePicker = document.getElementById("filePicker");
const errorEl = document.getElementById("error");
const captionTitle = document.getElementById("captionTitle");
const captionMeta = document.getElementById("captionMeta");
const albumTitleLayer = document.getElementById("albumTitleLayer");
const photoDrawer = document.getElementById("photoDrawer");
const drawerTitle = document.getElementById("drawerTitle");
const drawerMeta = document.getElementById("drawerMeta");
const drawerGrid = document.getElementById("drawerGrid");
const vinylStage = document.getElementById("vinylStage");
const vinylCtx = vinylStage.getContext("2d");

const collections = [
  makeCollection("warm", "日光暖调", "SUN TAPE", "#c74731", "#1c0c08", "#fff0c8", ["暖色", "旅行", "胶片"]),
  makeCollection("blue", "蓝色旅行", "BLUE SIDE", "#3e82a8", "#071423", "#e8f6ff", ["冷色", "天空", "远行"]),
  makeCollection("green", "绿意户外", "GREEN WALK", "#568b47", "#07120a", "#efffdc", ["植物", "户外", "自然"]),
  makeCollection("night", "夜色霓虹", "NIGHT LOG", "#5a4ab0", "#070615", "#f2eaff", ["暗调", "城市", "霓虹"]),
  makeCollection("paper", "纸面截图", "PAPER CUT", "#d9d0ba", "#18130e", "#17120c", ["截图", "文档", "白底"]),
  makeCollection("unknown", "未知记忆", "LOST MIX", "#9b6048", "#110b09", "#fff1de", ["混合", "未识别", "待命名"])
];

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
  detailCtx: detailCanvas.getContext("2d"),
  presentationPhase: "idle",
  presentationTimer: 0,
  lastTickTime: 0
};

const VS_HIDDEN = "hidden";
const VS_SLIDEUP = "slideUp";
const VS_CAROUSEL = "carousel";

const VINYL_SLIDEUP_MS = 600;
const FAN_ANGLE_STEP = 0.22;

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
  velocity: 0,
  dragPrevX: 0,
  dragPrevAngle: 0,
  dragging: false,
  photos: [],
  selectedIndex: 0,
  snapTarget: null,
  thumbs: [],
  animating: false,
  animFrame: 0,
  collectionId: null,
  palette: null
};

function setGroupOpacity(group, opacity) {
  group.traverse(function (child) {
    if (child.isMesh) {
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(function (m) {
        m.transparent = true;
        m.opacity = opacity;
        m.needsUpdate = true;
      });
    }
  });
}

function makeCollection(id, title, spine, primary, secondary, text, tags) {
  return { id, title, spine, palette: { primary, secondary, text }, tags, photos: [] };
}

const SCATTER_MS = 700;
const EXIT_ROTATION_SPEED = (2 * Math.PI) / 1400;

function boot() {
  try {
    seedSamples();
    setupThree();
    setupEvents();
    updateCaption();
    tick();
  } catch (err) {
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
  app.titlePlane = createTitlePlane(collections[0]);
  resize();
}

function createCaseGroup(collection, index) {
  const group = new THREE.Group();
  group.userData = { collectionId: collection.id, index };

  const coverTexture = makeCoverTexture(collection);
  const spineTexture = makeTextTexture(collection, "spine");
  const backTexture = makeTextTexture(collection, "back");
  const frontSpineTexture = makeFrontSpineTexture(collection);
  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(collection.palette.secondary),
    metalness: 0,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    transparent: true,
    opacity: 0.9
  });
  const spineMaterial = new THREE.MeshPhysicalMaterial({
    map: spineTexture,
    metalness: 0,
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.14
  });
  const frontSpineMaterial = new THREE.MeshPhysicalMaterial({
    map: frontSpineTexture,
    metalness: 0,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.12
  });
  const coverMaterial = new THREE.MeshStandardMaterial({ map: coverTexture, roughness: 0.45 });
  const backMaterial = new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.52 });

  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.42, 2.42, 0.36, 1, 1, 1),
    [spineMaterial, spineMaterial, frontSpineMaterial, frontSpineMaterial, coverMaterial, backMaterial]
  );
  group.add(caseMesh);

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
  plastic.position.z = 0.188;
  group.add(plastic);

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
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const c = canvas.getContext("2d");
  const first = collection.photos[0]?.source;
  const gradient = c.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, collection.palette.primary);
  gradient.addColorStop(1, "#020202");
  c.fillStyle = gradient;
  c.fillRect(0, 0, 1024, 1024);
  if (first) drawCoverImage(c, first, 72, 72, 880, 880);
  const shade = c.createLinearGradient(0, 0, 1024, 1024);
  shade.addColorStop(0, "rgba(255,255,255,.18)");
  shade.addColorStop(0.22, "rgba(255,255,255,0)");
  shade.addColorStop(0.64, "rgba(0,0,0,.1)");
  shade.addColorStop(1, "rgba(0,0,0,.24)");
  c.fillStyle = shade;
  c.fillRect(0, 0, 1024, 1024);
  c.strokeStyle = "rgba(255,255,255,.22)";
  c.lineWidth = 8;
  c.strokeRect(72, 72, 880, 880);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeTextTexture(collection, mode) {
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
  c.rotate(Math.PI / 2);
  c.textBaseline = "middle";
  c.fillStyle = collection.palette.text;
  c.textAlign = "center";
  c.font = `900 ${mode === "spine" ? 38 : 50}px Arial, sans-serif`;
  c.fillText(collection.spine, 0, 0, canvas.height - 280);
  c.fillStyle = collection.palette.text;
  c.globalAlpha = 0.72;
  c.font = "800 32px Arial, sans-serif";
  c.textAlign = "right";
  c.fillText("2026", canvas.height / 2 - 52, 0, 150);
  c.globalAlpha = 1;
  c.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeFrontSpineTexture(collection) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const c = canvas.getContext("2d");
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
  c.font = "900 42px Arial, sans-serif";
  c.fillText(collection.spine, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 160);
  c.fillStyle = "rgba(255,255,255,.58)";
  c.font = "800 28px Arial, sans-serif";
  c.fillText("2026", 82, canvas.height / 2 + 4, 110);
  c.fillText(collection.title, canvas.width - 130, canvas.height / 2 + 4, 220);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function tick() {
  try {
    app.frame = requestAnimationFrame(tick);

    const now = performance.now();
    const dtMs = app.lastTickTime ? Math.min(now - app.lastTickTime, 50) : 16.67;
    app.lastTickTime = now;

    if (app.presentationPhase === "scattering") {
      app.presentationTimer += dtMs;
      if (app.presentationTimer >= SCATTER_MS) {
        app.presentationPhase = "presenting";
        initVinylStage();
        const collection = collections[app.selectedIndex] || collections[0];
        vinyl.photos = collection.photos.slice();
        vinyl.selectedIndex = Math.round((collection.photos.length - 1) / 2);
        vinyl.angle = -vinyl.selectedIndex * FAN_ANGLE_STEP;
        vinyl.velocity = 0;
        vinyl.snapTarget = null;
        vinyl.thumbs = vinyl.photos.map(function(photo) {
          var c = document.createElement("canvas");
          var size = 120;
          var sw = photo.source.width || 480;
          var sh = photo.source.height || 640;
          var ratio = sw / sh;
          c.width = Math.round(size * ratio);
          c.height = size;
          var tctx = c.getContext("2d");
          tctx.drawImage(photo.source, 0, 0, c.width, c.height);
          return c;
        });
        vinyl.collectionId = collection.id;
        vinyl.palette = collection.palette;
        vinyl.phase = VS_SLIDEUP;
        vinyl.timer = performance.now();
        vinyl.vinylY = vinyl.h + vinyl.vinylR * 1.1;
        vinyl.vinylTargetY = vinyl.cy;
        startVinylLoop();
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

        if (isAnimating && app.flippedId) {
          const spread = index - flippedIndex;
          const dir = spread > 0 ? 1 : -1;
          const dist = Math.abs(spread);
          if (isFlipped) {
            targetX = 0;
            targetY = -4.5;
            targetZ = 1.2;
            targetRotX = THREE.MathUtils.degToRad(8);
            targetRotZ = 0;
            targetScale = 0.5;
            targetRotY = group.rotation.y + EXIT_ROTATION_SPEED * dtMs;
          } else {
            targetX = 0;
            targetRotY = 0;
            targetY = -clamped * 0.64;
            targetZ = 0.04 - Math.abs(clamped) * 0.025;
            targetRotX = THREE.MathUtils.degToRad(68);
            targetRotZ = spiralPhase * focusFalloff;
            targetScale = 0.76 - Math.min(Math.abs(clamped) * 0.02, 0.1);
          }
        } else if (app.flippedId) {
          const spread = index - flippedIndex;
          if (isFlipped) {
            targetY = 1.18;
            targetZ = 2.18;
            targetRotX = THREE.MathUtils.degToRad(-2);
            targetRotZ = 0;
            targetScale = 0.688;
          } else {
            targetY = spread < 0
              ? 2.52 + Math.abs(spread) * 0.24
              : 0.08 - Math.abs(spread) * 0.42;
            targetZ = -0.42 - Math.abs(spread) * 0.12;
            targetRotX = THREE.MathUtils.degToRad(68);
            targetRotZ = spiralPhase * 0.62;
            targetScale = 0.448 - Math.min(Math.abs(spread) * 0.028, 0.096);
          }
          targetX = 0;
          targetRotY = 0;
        } else {
          targetX = 0;
          targetRotY = 0;
          targetY = -clamped * 0.64;
          targetZ = 0.04 - Math.abs(clamped) * 0.025;
          targetRotX = THREE.MathUtils.degToRad(68);
          targetRotZ = spiralPhase * focusFalloff;
          targetScale = 0.76 - Math.min(Math.abs(clamped) * 0.02, 0.1);
        }
      } else {
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

      if (isAnimating && app.flippedId && !isFlipped && app.presentationPhase === "scattering") {
        var fadeT = Math.min(app.presentationTimer / SCATTER_MS, 1);
        setGroupOpacity(group, 1 - fadeT);
        group.userData._faded = true;
        if (fadeT >= 0.98) group.visible = false;
      } else if (group.userData._faded && app.presentationPhase !== "scattering") {
        group.visible = false;
      }

      if (!isAnimating) {
        if (group.userData._faded) {
          setGroupOpacity(group, 1);
          group.userData._faded = false;
        }
        group.visible = Math.abs(clamped) < (portrait ? 4.2 : 8) || isReceding || isFlipped;
      } else if (!group.userData._faded) {
        group.visible = Math.abs(clamped) < (portrait ? 4.2 : 8) || isReceding || isFlipped;
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
  app.camera.position.set(0, portrait ? 0.12 : 0.14, portrait ? 10.2 : 8.2);
  app.camera.lookAt(0, 0, 0);
  app.camera.updateProjectionMatrix();
  syncPresentationClass();
  if (vinyl.phase !== VS_HIDDEN) resizeVinyl();
}

function setupEvents() {
  addEventListener("resize", resize, { passive: true });
  sceneCanvas.addEventListener("pointerdown", onPointerDown, { passive: true });
  sceneCanvas.addEventListener("pointermove", onPointerMove, { passive: true });
  sceneCanvas.addEventListener("pointerup", onPointerUp, { passive: true });
  sceneCanvas.addEventListener("pointercancel", () => { app.drag = null; }, { passive: true });
  sceneCanvas.addEventListener("wheel", onWheel, { passive: false });
  vinylStage.addEventListener("pointerdown", onVinylPointerDown);
  vinylStage.addEventListener("pointermove", onVinylPointerMove);
  vinylStage.addEventListener("pointerup", onVinylPointerUp);
  importBtn.addEventListener("click", () => filePicker.click());
  backBtn.addEventListener("click", () => { hidePresentation(); });
  filePicker.addEventListener("change", () => handleFiles(filePicker.files));
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
  sceneCanvas.setPointerCapture?.(event.pointerId);
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
  const hit = pickGroup(event.clientX, event.clientY);
  if (!hit) {
    hidePresentation();
    return;
  }
  const collection = collections[hit.userData.index];
  app.selectedIndex = hit.userData.index;
  app.targetPosition = app.selectedIndex;
  if (innerHeight >= innerWidth) {
    presentCollection(app.selectedIndex);
    return;
  }
  if (app.flippedId === collection.id) return;
  else {
    app.flippedId = collection.id;
    hideDrawer();
  }
  updateCaption();
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
  captionTitle.textContent = c.title;
  captionMeta.textContent = `${c.photos.length} 张 · ${c.tags.join(" / ")}`;
  syncPresentationClass();
}

function presentCollection(index) {
  app.selectedIndex = index;
  app.targetPosition = index;
  app.flippedId = collections[index].id;
  app.presentationPhase = "scattering";
  app.presentationTimer = 0;
  app.lastTickTime = 0;
  updateCaption();
}

function hidePresentation() {
  if (vinyl.phase !== VS_HIDDEN) {
    vinyl.phase = VS_HIDDEN;
    stopVinylLoop();
    vinylStage.classList.remove("active");
    document.body.classList.remove("presenting");
  }
  app.flippedId = null;
  app.presentationPhase = "idle";
  app.presentationTimer = 0;
  updateCaption();
}

function renderDrawer(index) {
  var collection = collections[index];
  if (!collection) return;
  drawerTitle.textContent = collection.title;
  drawerMeta.textContent = collection.photos.length + " 张";
  drawerGrid.innerHTML = "";
  collection.photos.forEach(function(photo, i) {
    var btn = document.createElement("button");
    btn.className = "photo-thumb";
    btn.setAttribute("type", "button");
    btn.style.backgroundImage = "url(" + photoToThumb(photo) + ")";
    var sw = photo.source.width || 480;
    var sh = photo.source.height || 640;
    btn.style.aspectRatio = (sw / sh).toFixed(4);
    if (i === app.drawerPhoto) btn.classList.add("active");
    var label = document.createElement("span");
    label.textContent = photo.name;
    btn.appendChild(label);
    btn.addEventListener("click", (function(idx) {
      return function() { onDrawerClick(index, idx); };
    })(i));
    drawerGrid.appendChild(btn);
  });
  photoDrawer.classList.add("open");
}

function hideDrawer() {
  photoDrawer.classList.remove("open");
}

function onDrawerClick(collectionIdx, photoIdx) {
  app.drawerPhoto = photoIdx;
  app.detailCollection = collectionIdx;
  app.detailPhoto = photoIdx;
  var thumbs = drawerGrid.querySelectorAll(".photo-thumb");
  thumbs.forEach(function(t, i) { t.classList.toggle("active", i === photoIdx); });
}

function syncPresentationClass() {
  const collection = collections[app.selectedIndex] || collections[0];
  const presenting = Boolean(app.flippedId && innerHeight >= innerWidth
    && (app.presentationPhase === "rotating" || app.presentationPhase === "presenting"));
  document.body.classList.toggle("presenting", presenting);
  if (albumTitleLayer) albumTitleLayer.querySelector("strong").textContent = collection.title;
  updateTitlePlane(collection);
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
  vinyl.cy = h;
  vinyl.vinylR = Math.min(w, h) * 0.44;
  vinyl.ringR = vinyl.vinylR * 1.38;
  vinyl.vinylTargetY = vinyl.cy;
}

function drawVinylDisc(ctx, cx, cy, r, angle, palette) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const discGrad = ctx.createRadialGradient(cx - r * 0.05, cy - r * 0.03, 0, cx, cy, r);
  discGrad.addColorStop(0, "#1a1816"); discGrad.addColorStop(0.88, "#0d0b0a"); discGrad.addColorStop(1, "#060505");
  ctx.fillStyle = discGrad; ctx.fill();

  for (let i = 1; i <= 5; i++) {
    const gr = r * (0.58 + i * 0.075);
    ctx.beginPath(); ctx.arc(cx, cy, gr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255," + (0.018 + i * 0.003) + ")";
    ctx.lineWidth = 0.5; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = 0.5; ctx.stroke();

  const labelR = r * 0.3;
  ctx.beginPath(); ctx.arc(cx, cy, labelR, 0, Math.PI * 2);
  ctx.fillStyle = palette.primary; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, labelR * 0.92, 0, Math.PI * 2);
  ctx.fillStyle = palette.secondary; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, labelR * 0.92, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = palette.primary;
  ctx.font = "800 " + (labelR * 0.38) + "px Impact, Arial Black, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("RECALL", cx, cy - labelR * 0.16);
  ctx.font = "700 " + (labelR * 0.24) + "px Arial, sans-serif";
  ctx.fillStyle = palette.text;
  ctx.fillText("CD · 2026", cx, cy + labelR * 0.28);
  ctx.restore();

  ctx.beginPath(); ctx.arc(cx, cy, r * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = "#020202"; ctx.fill();

  const shine = ctx.createLinearGradient(cx - r, cy - r * 0.5, cx + r, cy + r * 0.5);
  shine.addColorStop(0, "rgba(255,255,255,0)"); shine.addColorStop(0.45, "rgba(255,255,255,.04)");
  shine.addColorStop(0.55, "rgba(255,255,255,.06)"); shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = shine; ctx.fill();

  const angleLine = angle + Math.PI * 0.4;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(angleLine) * labelR * 1.08, cy + Math.sin(angleLine) * labelR * 1.08);
  ctx.lineTo(cx + Math.cos(angleLine) * r * 0.92, cy + Math.sin(angleLine) * r * 0.92);
  ctx.strokeStyle = "rgba(255,255,255,.09)"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
}

function drawVinylCarousel(ctx) {
  const cx = vinyl.cx, cy = vinyl.vinylY, ringR = vinyl.ringR;
  const photos = vinyl.photos;
  const thumbs = vinyl.thumbs;
  if (!photos.length) return;
  const n = photos.length;
  const topAngle = -Math.PI / 2;
  const centerIdx = vinyl.selectedIndex;
  const EMPHASIS_RANGE = 0.5;
  const maxLift = ringR * 0.06;

  // selection-zone glow arc on the ring at top
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, topAngle - 0.22, topAngle + 0.22);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "rgba(255,255,255,0.35)";
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.restore();

  // downward triangle marker at selection point
  var mkX = cx;
  var mkY = cy - ringR - 6;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.shadowColor = "rgba(255,255,255,0.55)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(mkX, mkY + 5);
  ctx.lineTo(mkX - 6, mkY - 5);
  ctx.lineTo(mkX + 6, mkY - 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  for (var i = 0; i < n; i++) {
    var a = topAngle + vinyl.angle + (i - centerIdx) * FAN_ANGLE_STEP;
    var diff = a - topAngle;
    if (Math.abs(diff) > Math.PI * 0.9) continue;

    var dist = Math.abs(diff);
    var p = Math.max(0, 1 - dist / EMPHASIS_RANGE);
    var pSmooth = 0.5 - 0.5 * Math.cos(p * Math.PI);

    var scale = 0.62 + (1.18 - 0.62) * pSmooth;
    var alpha = 0.4 + 0.6 * pSmooth;
    var liftY = -maxLift * pSmooth;
    var borderAlpha = pSmooth;

    var px = cx + Math.cos(a) * ringR;
    var py = cy + Math.sin(a) * ringR + liftY;

    var baseW = ringR * 0.22;
    var thumbW = baseW * scale;
    var thumbSrc = thumbs[i];
    var thumbH;
    if (thumbSrc) {
      thumbH = thumbW / (thumbSrc.width / thumbSrc.height);
    } else {
      thumbH = thumbW / 0.75;
    }

    // outer glow near center
    if (pSmooth > 0.05) {
      ctx.save();
      ctx.globalAlpha = pSmooth * 0.55;
      ctx.shadowColor = "rgba(255,255,255,0.45)";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      roundRect(ctx, px - thumbW / 2, py - thumbH / 2, thumbW, thumbH, 5);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fill();
      ctx.restore();
    }

    // thumbnail image
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    roundRect(ctx, px - thumbW / 2, py - thumbH / 2, thumbW, thumbH, 5);
    ctx.clip();
    if (thumbSrc) {
      try { ctx.drawImage(thumbSrc, px - thumbW / 2, py - thumbH / 2, thumbW, thumbH); }
      catch (_) { ctx.fillStyle = "#1a1714"; ctx.fillRect(px - thumbW / 2, py - thumbH / 2, thumbW, thumbH); }
    } else {
      ctx.fillStyle = "#1a1714";
      ctx.fillRect(px - thumbW / 2, py - thumbH / 2, thumbW, thumbH);
    }
    ctx.restore();

    // border - continuous opacity from proximity
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(255,255,255," + (0.12 + 0.88 * borderAlpha).toFixed(2) + ")";
    ctx.lineWidth = 0.5 + 2.7 * borderAlpha;
    if (borderAlpha > 0.3) {
      ctx.shadowColor = "rgba(255,255,255," + (0.55 * borderAlpha).toFixed(2) + ")";
      ctx.shadowBlur = 10 * borderAlpha;
    }
    ctx.beginPath();
    roundRect(ctx, px - thumbW / 2, py - thumbH / 2, thumbW, thumbH, 5);
    ctx.stroke();
    ctx.restore();
  }
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

  if (vinyl.phase === VS_SLIDEUP) {
    const elapsed = now - vinyl.timer;
    const t = Math.min(elapsed / VINYL_SLIDEUP_MS, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    vinyl.vinylY = h + vinyl.vinylR * 1.1 - ease * (h + vinyl.vinylR * 1.1 - vinyl.vinylTargetY);
    if (t >= 1) { enterCarousel(); }
  } else if (vinyl.phase === VS_CAROUSEL) {
    if (!vinyl.dragging && vinyl.snapTarget !== null) {
      vinyl.angle += (vinyl.snapTarget - vinyl.angle) * 0.32;
      vinyl.selectedIndex = clamp(Math.round(-vinyl.angle / FAN_ANGLE_STEP), 0, vinyl.photos.length - 1);
      if (Math.abs(vinyl.snapTarget - vinyl.angle) < 0.0005) {
        vinyl.angle = vinyl.snapTarget;
        vinyl.snapTarget = null;
      }
    } else if (!vinyl.dragging && Math.abs(vinyl.velocity) > 0.0001) {
      const n = vinyl.photos.length;
      vinyl.angle += vinyl.velocity;
      vinyl.velocity *= 0.94;
      vinyl.angle = clamp(vinyl.angle, -(n - 1) * FAN_ANGLE_STEP, 0);
      vinyl.selectedIndex = clamp(Math.round(-vinyl.angle / FAN_ANGLE_STEP), 0, n - 1);
      if (Math.abs(vinyl.velocity) < 0.002) {
        vinyl.velocity = 0;
        snapCarousel();
      }
    }
  }

  ctx.clearRect(0, 0, w, h);

  if (vinyl.phase === VS_CAROUSEL && vinyl.photos.length > 0) {
    const photo = vinyl.photos[vinyl.selectedIndex];
    if (photo) {
      const topArea = vinyl.vinylY - vinyl.ringR * 1.25;
      const maxW = w * 0.78;
      const maxH = topArea * 0.82;
      const sw = photo.source.width || 480;
      const sh = photo.source.height || 640;
      const ratio = sw / sh;
      let dw, dh;
      if (maxW / maxH > ratio) { dh = maxH; dw = dh * ratio; }
      else { dw = maxW; dh = dw / ratio; }
      const px = (w - dw) / 2;
      const py = (topArea - dh) / 2;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#111";
      ctx.fillRect(px, py, dw, dh);
      ctx.shadowColor = "transparent";
      ctx.drawImage(photo.source, px, py, dw, dh);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, dw, dh);
      ctx.restore();
    }
  }

  if (vinyl.phase === VS_CAROUSEL) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, w, 44);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "600 12px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("← 点击此处返回货架", w / 2, 28);
  }

  drawVinylDisc(ctx, vinyl.cx, vinyl.vinylY, vinyl.vinylR, vinyl.angle, vinyl.palette || { primary: "#c74731", secondary: "#1c0c08", text: "#fff0c8" });
  if (vinyl.phase === VS_CAROUSEL) {
    drawVinylCarousel(ctx);
  }
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
  vinyl.velocity = 0;
}

function snapCarousel() {
  const n = vinyl.photos.length;
  let idx = Math.round(-vinyl.angle / FAN_ANGLE_STEP);
  idx = clamp(idx, 0, n - 1);
  vinyl.selectedIndex = idx;
  vinyl.snapTarget = -idx * FAN_ANGLE_STEP;
}

function onVinylPointerDown(e) {
  if (vinyl.phase !== VS_CAROUSEL) return;
  if (e.clientY < vinyl.h * 0.12) { hidePresentation(); return; }
  vinyl.dragging = true;
  vinyl.velocity = 0;
  vinyl.snapTarget = null;
  vinyl.dragPrevX = e.clientX;
  vinyl.dragPrevAngle = vinyl.angle;
}

function onVinylPointerMove(e) {
  if (!vinyl.dragging) return;
  const dx = e.clientX - vinyl.dragPrevX;
  const n = vinyl.photos.length;
  vinyl.angle = clamp(
    vinyl.dragPrevAngle + dx / vinyl.ringR,
    -(n - 1) * FAN_ANGLE_STEP,
    0
  );
  vinyl.selectedIndex = clamp(Math.round(-vinyl.angle / FAN_ANGLE_STEP), 0, n - 1);
}

function onVinylPointerUp(e) {
  if (!vinyl.dragging) return;
  const dx = e.clientX - vinyl.dragPrevX;
  vinyl.velocity = dx / vinyl.ringR * 0.12;
  vinyl.dragging = false;
}

function seedSamples() {
  collections.forEach((collection) => {
    for (let i = 0; i < 3; i += 1) {
      const source = createSample(collection.id, i);
      const analysis = analyzeSource(source);
      collection.photos.push({
        id: `${collection.id}-${i}`,
        name: `${collection.title.replace(/..$/, "")} ${String(i + 1).padStart(2, "0")}`,
        source,
        paletteLabel: analysis.paletteLabel,
        sceneLabel: analysis.sceneLabel,
        timeLabel: "样例时间",
        locationLabel: "无可读地点"
      });
    }
  });
}

function createSample(kind, variant) {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 640;
  const c = canvas.getContext("2d");
  const grad = c.createLinearGradient(0, 0, 480, 640);
  const palettes = {
    warm: ["#f4b45e", "#d95f39", "#31120f"],
    blue: ["#8bd2e9", "#3f82a9", "#12334d"],
    green: ["#b8d88e", "#5e9852", "#102411"],
    night: ["#161631", "#25175a", "#03020b"],
    paper: ["#f7f3e9", "#ded6c3", "#b8aa93"],
    unknown: ["#c4825e", "#745a69", "#171318"]
  }[kind];
  grad.addColorStop(0, palettes[0]);
  grad.addColorStop(.55, palettes[1]);
  grad.addColorStop(1, palettes[2]);
  c.fillStyle = grad;
  c.fillRect(0, 0, 480, 640);
  if (kind === "warm") {
    c.fillStyle = "rgba(255,230,160,.72)";
    c.beginPath(); c.arc(120 + variant * 30, 132, 55, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(40,18,15,.8)";
    for (let i = 0; i < 5; i += 1) {
      c.beginPath(); c.moveTo(-40 + i * 130, 560); c.lineTo(80 + i * 115, 315); c.lineTo(180 + i * 115, 560); c.closePath(); c.fill();
    }
  } else if (kind === "blue") {
    c.fillStyle = "rgba(255,255,255,.55)";
    for (let i = 0; i < 6; i += 1) { c.beginPath(); c.ellipse(60 + i * 86, 140 + (i % 2) * 28, 48, 14, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = "#1d4a67"; c.fillRect(0, 400, 480, 240);
  } else if (kind === "green") {
    for (let i = 0; i < 18; i += 1) {
      c.fillStyle = i % 2 ? "#1f5b2e" : "#386f34";
      const x = (i * 39 + variant * 17) % 480; const h = 230 + ((i * 53) % 180);
      c.fillRect(x, 640 - h, 22, h); c.beginPath(); c.arc(x + 12, 640 - h + 18, 34, 0, Math.PI * 2); c.fill();
    }
  } else if (kind === "night") {
    for (let i = 0; i < 13; i += 1) {
      const x = 18 + i * 38; const h = 150 + ((i * 47 + variant * 26) % 290);
      c.fillStyle = i % 2 ? "#111323" : "#0a0b16"; c.fillRect(x, 640 - h, 30, h);
      c.fillStyle = i % 3 ? "#f4c257" : "#58d7ff";
      for (let y = 640 - h + 18; y < 622; y += 34) if ((y + i + variant) % 3) c.fillRect(x + 7, y, 7, 12);
    }
  } else if (kind === "paper") {
    c.fillStyle = "rgba(255,255,255,.82)"; c.fillRect(56, 64, 368, 500);
    c.fillStyle = "rgba(25,24,20,.55)";
    for (let i = 0; i < 11; i += 1) c.fillRect(92, 160 + i * 32, 180 + ((i * 47 + variant * 60) % 160), 7);
  } else {
    for (let i = 0; i < 28; i += 1) {
      c.fillStyle = `hsla(${(i * 37 + variant * 40) % 360},48%,${42 + (i % 4) * 8}%,.42)`;
      c.beginPath(); c.ellipse((i * 61) % 480, (i * 97) % 640, 68, 30, i, 0, Math.PI * 2); c.fill();
    }
  }
  return canvas;
}

function analyzeSource(source) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const c = canvas.getContext("2d", { willReadFrequently: true });
  c.drawImage(source, 0, 0, 64, 64);
  const data = c.getImageData(0, 0, 64, 64).data;
  let r = 0, g = 0, b = 0, n = 0, dark = 0, white = 0, green = 0, blue = 0;
  for (let i = 0; i < data.length; i += 16) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
    const lum = (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) / 255;
    if (lum < .22) dark += 1;
    if (lum > .82) white += 1;
    if (data[i + 1] > data[i] * 1.1 && data[i + 1] > data[i + 2] * 1.05) green += 1;
    if (data[i + 2] > data[i] * 1.1 && data[i + 2] > data[i + 1] * .9) blue += 1;
  }
  r /= n; g /= n; b /= n;
  if (white / n > .45) return { paletteLabel: "纸面低饱和", sceneLabel: "截图/文档", collectionId: "paper" };
  if (dark / n > .44) return { paletteLabel: "暗调霓虹", sceneLabel: "夜景/室内", collectionId: "night" };
  if (green / n > .24) return { paletteLabel: "绿色自然", sceneLabel: "户外/植物", collectionId: "green" };
  if (blue / n > .24) return { paletteLabel: "蓝色冷调", sceneLabel: "天空/旅行", collectionId: "blue" };
  if (r > b && r > g * .82) return { paletteLabel: "暖色胶片", sceneLabel: "日光/人像", collectionId: "warm" };
  return { paletteLabel: "混合色系", sceneLabel: "未知记忆", collectionId: "unknown" };
}

async function handleFiles(files) {
  if (!files || !files.length) return;
  for (const file of Array.from(files).slice(0, 40)) {
    try {
      const image = await fileToImage(file);
      const analysis = analyzeSource(image);
      const target = collections.find((c) => c.id === analysis.collectionId) || collections[5];
      target.photos.unshift({
        id: `user-${Date.now()}-${Math.random()}`,
        name: cleanName(file.name),
        source: image,
        paletteLabel: analysis.paletteLabel,
        sceneLabel: analysis.sceneLabel,
        timeLabel: file.lastModified ? `文件 ${formatDate(file.lastModified)}` : "未知时间",
        locationLabel: "无可读地点"
      });
      rebuildCase(target);
    } catch {
      continue;
    }
  }
  if (app.flippedId && innerHeight >= innerWidth) renderDrawer(app.selectedIndex);
  updateCaption();
}

function rebuildCase(collection) {
  const index = collections.findIndex((c) => c.id === collection.id);
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

function fileToImage(file) {
  if ("createImageBitmap" in globalThis) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("load", () => resolve(image));
      image.addEventListener("error", reject);
      image.src = reader.result;
    });
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
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

function cleanName(name) {
  return (name || "未命名照片").replace(/\.[^.]+$/, "").slice(0, 24);
}

function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
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
  errorEl.textContent = ERROR_TEXT;
  errorEl.classList.add("show");
  console.error(err);
}

boot();
