import * as THREE from "./three.module.min.js";
import {
  analyzePalette,
  classifyPhoto,
  getCriterionLabel,
  makeAdaptivePalette,
  makeManualGroup,
  parsePhotoMetadata
} from "./classifier.js";

const ERROR_TEXT = "哎呀，出错了，请重启试试吧~";
const IMPORT_UNREADABLE_TEXT = "这批照片暂时无法读取，请换一张或转成 JPG/PNG 再试试";
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
const importModal = document.getElementById("importModal");
const criterionButtons = Array.from(document.querySelectorAll("[data-criterion]"));
const chooseFilesBtn = document.getElementById("chooseFilesBtn");
const cancelImportBtn = document.getElementById("cancelImportBtn");
const movePanel = document.getElementById("movePanel");
const moveTitle = document.getElementById("moveTitle");
const moveChoices = document.getElementById("moveChoices");
const moveCustomInput = document.getElementById("moveCustomInput");
const moveCustomBtn = document.getElementById("moveCustomBtn");
const moveCloseBtn = document.getElementById("moveCloseBtn");

let collections = [];
let allPhotos = [];
let noticeTimer = 0;

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
  pendingCriterion: "palette",
  hasUserPhotos: false,
  detailCtx: detailCanvas.getContext("2d")
};

function makeCollection(id, title, spine, palette, tags, photos = [], criterion = "palette") {
  return { id, title, spine, palette, tags, photos, criterion, cornerLabel: getCriterionLabel(criterion).toUpperCase() };
}

function boot() {
  try {
    seedSamples();
    collections = buildCollections(app.currentCriterion);
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
  c.fillText(collection.cornerLabel || "CD", canvas.height / 2 - 52, 0, 190);
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
  c.fillText(collection.cornerLabel || "CD", 92, canvas.height / 2 + 4, 150);
  c.fillText(collection.title, canvas.width - 130, canvas.height / 2 + 4, 220);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function tick() {
  try {
    app.frame = requestAnimationFrame(tick);
    app.shelfPosition += (app.targetPosition - app.shelfPosition) * 0.075;
    app.spin += (app.spinTarget - app.spin) * 0.09;
    const portrait = innerHeight >= innerWidth;

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
        targetX = 0;
        targetRotY = 0;
        if (app.flippedId) {
          const spread = index - flippedIndex;
          if (isFlipped) {
            targetY = 1.18;
            targetZ = 2.18;
            targetRotX = THREE.MathUtils.degToRad(-2);
            targetRotZ = 0;
            targetScale = 0.86;
          } else {
            targetY = spread < 0
              ? 2.52 + Math.abs(spread) * 0.24
              : 0.08 - Math.abs(spread) * 0.42;
            targetZ = -0.42 - Math.abs(spread) * 0.12;
            targetRotX = THREE.MathUtils.degToRad(68);
            targetRotZ = spiralPhase * 0.62;
            targetScale = 0.56 - Math.min(Math.abs(spread) * 0.035, 0.12);
          }
        } else {
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
      group.rotation.x += (targetRotX - group.rotation.x) * 0.11;
      group.rotation.y += (targetRotY - group.rotation.y) * 0.11;
      group.rotation.z += (targetRotZ - group.rotation.z) * 0.11;
      const nextScale = group.scale.x + (targetScale - group.scale.x) * 0.11;
      group.scale.setScalar(nextScale);
      group.visible = Math.abs(clamped) < (portrait ? 4.2 : 8) || isReceding || isFlipped;
    });

    if (app.titlePlane) {
      const showTitlePlane = Boolean(portrait && app.flippedId);
      app.titlePlane.visible = showTitlePlane;
      if (showTitlePlane) {
        app.titlePlane.position.lerp(new THREE.Vector3(0, 1.18, 1.44), 0.16);
        app.titlePlane.rotation.set(0, 0, 0);
        app.titlePlane.scale.setScalar(1);
      }
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
  drawDetail();
}

function setupEvents() {
  addEventListener("resize", resize, { passive: true });
  sceneCanvas.addEventListener("pointerdown", onPointerDown, { passive: true });
  sceneCanvas.addEventListener("pointermove", onPointerMove, { passive: true });
  sceneCanvas.addEventListener("pointerup", onPointerUp, { passive: true });
  sceneCanvas.addEventListener("pointercancel", () => { app.drag = null; }, { passive: true });
  sceneCanvas.addEventListener("wheel", onWheel, { passive: false });
  importBtn.addEventListener("click", () => openImportModal());
  chooseFilesBtn.addEventListener("click", () => filePicker.click());
  cancelImportBtn.addEventListener("click", () => closeImportModal());
  criterionButtons.forEach((button) => button.addEventListener("click", () => selectImportCriterion(button.dataset.criterion)));
  backBtn.addEventListener("click", () => closeDetail());
  filePicker.addEventListener("change", () => handleFiles(filePicker.files, app.pendingCriterion));
  drawerGrid.addEventListener("click", onDrawerClick);
  moveCustomBtn.addEventListener("click", moveToCustomGroup);
  moveCloseBtn.addEventListener("click", hideMovePanel);
}

function openImportModal() {
  app.pendingCriterion = app.currentCriterion || "palette";
  selectImportCriterion(app.pendingCriterion);
  importModal.classList.add("open");
}

function closeImportModal() {
  importModal.classList.remove("open");
}

function selectImportCriterion(criterion) {
  app.pendingCriterion = ["palette", "location", "time"].includes(criterion) ? criterion : "palette";
  criterionButtons.forEach((button) => button.classList.toggle("active", button.dataset.criterion === app.pendingCriterion));
}

function onPointerDown(event) {
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
  if (app.flippedId === collection.id) openDetail(app.selectedIndex);
  else {
    app.flippedId = collection.id;
    hideDrawer();
  }
  updateCaption();
}

function onWheel(event) {
  event.preventDefault();
  if (app.flippedId) return;
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
  if (!c) return;
  captionTitle.textContent = c.title;
  captionMeta.textContent = `${c.photos.length} 张 · ${getCriterionLabel(app.currentCriterion)} · ${c.tags.join(" / ")}`;
  syncPresentationClass();
}

function presentCollection(index) {
  app.selectedIndex = index;
  app.targetPosition = index;
  app.flippedId = collections[index].id;
  app.drawerPhoto = 0;
  renderDrawer(index);
  updateCaption();
}

function hidePresentation() {
  app.flippedId = null;
  hideDrawer();
  hideMovePanel();
  updateCaption();
}

function syncPresentationClass() {
  const collection = collections[app.selectedIndex] || collections[0];
  const presenting = Boolean(app.flippedId && innerHeight >= innerWidth);
  document.body.classList.toggle("presenting", presenting);
  if (albumTitleLayer) albumTitleLayer.querySelector("strong").textContent = collection.title;
  updateTitlePlane(collection);
}

function renderDrawer(index) {
  const collection = collections[index] || collections[0];
  if (!collection) return;
  drawerTitle.textContent = collection.title;
  drawerMeta.textContent = `${collection.photos.length} 张`;
  drawerGrid.replaceChildren();
  collection.photos.forEach((photo, photoIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `photo-thumb${photoIndex === app.drawerPhoto ? " active" : ""}`;
    button.dataset.photoIndex = String(photoIndex);
    button.style.backgroundImage = `url("${photoToThumb(photo)}")`;
    const label = document.createElement("span");
    label.textContent = getPhotoDrawerLabel(photo);
    button.append(label);
    drawerGrid.append(button);
  });
  photoDrawer.classList.add("open");
}

function getPhotoDrawerLabel(photo) {
  if (!photo) return "";
  if (app.currentCriterion === "location") return `${photo.locationLabel || "未知地点"} · ${photo.paletteLabel}`;
  if (app.currentCriterion === "time") return `${photo.timeLabel || "未知时间"} · ${photo.paletteLabel}`;
  return `${photo.paletteLabel} · ${photo.sceneLabel}`;
}

function hideDrawer() {
  photoDrawer.classList.remove("open");
  hideMovePanel();
}

function onDrawerClick(event) {
  const button = event.target.closest(".photo-thumb");
  if (!button) return;
  app.drawerPhoto = Number(button.dataset.photoIndex || 0);
  app.detailPhoto = app.drawerPhoto;
  drawerGrid.querySelectorAll(".photo-thumb").forEach((item, index) => {
    item.classList.toggle("active", index === app.drawerPhoto);
  });
  showMovePanel((collections[app.selectedIndex] || collections[0])?.photos[app.drawerPhoto]);
}

function showMovePanel(photo) {
  if (!photo) return;
  movePanel.dataset.photoId = photo.id;
  moveTitle.textContent = `移动：${photo.name}`;
  moveChoices.replaceChildren();
  collections.forEach((collection) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = collection.title;
    button.dataset.collectionId = collection.id;
    button.className = collection.photos.some((item) => item.id === photo.id) ? "active" : "";
    button.addEventListener("click", () => movePhotoToGroup(photo.id, {
      key: collection.id,
      title: collection.title,
      spine: collection.spine
    }));
    moveChoices.append(button);
  });
  moveCustomInput.value = "";
  movePanel.classList.add("open");
}

function hideMovePanel() {
  movePanel.classList.remove("open");
  movePanel.dataset.photoId = "";
}

function movePhotoToGroup(photoId, group) {
  const photo = allPhotos.find((item) => item.id === photoId);
  if (!photo) return;
  photo.manualGroupByCriterion ||= {};
  photo.manualGroupByCriterion[app.currentCriterion] = group;
  hideMovePanel();
  regroupCollections(app.currentCriterion, group.key);
}

function moveToCustomGroup() {
  const photoId = movePanel.dataset.photoId;
  const group = makeManualGroup(moveCustomInput.value, app.currentCriterion);
  movePhotoToGroup(photoId, group);
}

function openDetail(index) {
  app.detailCollection = index;
  app.detailPhoto = 0;
  hideDrawer();
  detail.classList.add("open");
  drawDetail();
}

function closeDetail() {
  detail.classList.remove("open");
  app.flippedId = collections[app.detailCollection].id;
  if (innerHeight >= innerWidth) renderDrawer(app.detailCollection);
  updateCaption();
}

function buildCollections(criterion) {
  const groups = new Map();
  allPhotos.forEach((photo) => {
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
      const firstColor = photos[0]?.dominantColor || "#8a6a55";
      return makeCollection(info.key, info.title, info.spine, makeAdaptivePalette(firstColor), info.tags, photos, criterion);
    });
}

function regroupCollections(criterion, preferredCollectionId = null) {
  const previousId = preferredCollectionId || collections[app.selectedIndex]?.id;
  disposeCaseGroups();
  collections = buildCollections(criterion);
  app.groups = collections.map((collection, index) => createCaseGroup(collection, index));
  const nextIndex = Math.max(0, collections.findIndex((collection) => collection.id === previousId));
  app.selectedIndex = clamp(nextIndex, 0, Math.max(collections.length - 1, 0));
  app.targetPosition = app.selectedIndex;
  app.shelfPosition = app.selectedIndex;
  app.flippedId = collections[app.selectedIndex]?.id || null;
  app.drawerPhoto = 0;
  app.detailPhoto = 0;
  if (app.flippedId && innerHeight >= innerWidth) renderDrawer(app.selectedIndex);
  else hideDrawer();
  updateCaption();
}

function disposeCaseGroups() {
  app.groups.forEach((group) => {
    app.scene.remove(group);
    group.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((material) => {
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
    text(ctx, collection.tags.join(" · "), 30, 206, 18, "#fff0ba", 800, "left", "Georgia");
    drawCoverImage(ctx, photo.source, 0, panelH, w, h - panelH - 104);
    drawPhotoMeta(ctx, photo, 0, panelH, w, h - panelH - 104);
    drawStrip(ctx, collection, 0, h - 104, w, 104);
  } else {
    const leftW = w * 0.42;
    ctx.fillStyle = collection.palette.primary;
    ctx.fillRect(0, 0, leftW, h);
    text(ctx, "CHAPTER " + String(app.detailCollection + 1).padStart(2, "0"), 34, 76, 11, "rgba(20,10,8,.56)", 900);
    text(ctx, collection.title, 34, 160, clamp(leftW * 0.18, 52, 90), "#120908", 900, "left", "Impact, Arial Black");
    text(ctx, collection.tags.join(" · "), 38, 250, 18, "#fff0ba", 800, "left", "Georgia");
    drawCoverImage(ctx, photo.source, leftW, 0, w - leftW, h);
    drawPhotoMeta(ctx, photo, leftW, 0, w - leftW, h);
  }
}

function drawPhotoMeta(ctx, photo, x, y, w, h) {
  const grd = ctx.createLinearGradient(x, y + h * 0.45, x, y + h);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,.72)");
  ctx.fillStyle = grd;
  ctx.fillRect(x, y, w, h);
  text(ctx, photo.name, x + 26, y + h - 68, 22, "#fff8ec", 900, "left", "Georgia");
  text(ctx, `${photo.paletteLabel} · ${photo.sceneLabel}`, x + 26, y + h - 38, 12, "rgba(255,248,236,.72)", 800);
  text(ctx, String(app.detailPhoto + 1).padStart(2, "0"), x + w - 24, y + h - 36, clamp(w * .12, 48, 86), "rgba(255,248,236,.92)", 900, "right", "Impact");
}

function drawStrip(ctx, collection, x, y, w, h) {
  ctx.fillStyle = "#060505";
  ctx.fillRect(x, y, w, h);
  const size = 44;
  collection.photos.slice(0, 8).forEach((photo, i) => {
    const tx = 18 + i * 52;
    drawCoverImage(ctx, photo.source, tx, y + 10, size, size);
    ctx.strokeStyle = i === app.detailPhoto ? "#fff0b8" : "rgba(255,255,255,.24)";
    ctx.lineWidth = i === app.detailPhoto ? 3 : 1;
    ctx.strokeRect(tx, y + 10, size, size);
  });
  const photo = collection.photos[app.detailPhoto] || collection.photos[0];
  text(ctx, photo.timeLabel, 18, y + h - 26, 11, "rgba(255,248,236,.64)", 800);
  text(ctx, photo.locationLabel, w - 18, y + h - 26, 11, "rgba(255,248,236,.64)", 800, "right");
}

function seedSamples() {
  ["warm", "blue", "green", "night", "paper", "unknown"].forEach((kind) => {
    for (let i = 0; i < 3; i += 1) {
      const source = createSample(kind, i);
      const analysis = analyzePalette(source);
      allPhotos.push({
        id: `sample-${kind}-${i}`,
        isSample: true,
        name: `${analysis.paletteLabel.replace(/..$/, "")} ${String(i + 1).padStart(2, "0")}`,
        source,
        paletteKey: analysis.collectionId,
        paletteLabel: analysis.paletteLabel,
        sceneLabel: analysis.sceneLabel,
        dominantColor: analysis.dominantColor,
        timeLabel: "样例时间",
        timeKey: "sample-time",
        timeSource: "sample",
        locationLabel: "未知地点",
        locationKey: "unknown-location",
        locationSource: "sample",
        manualGroupByCriterion: {}
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

async function handleFiles(files, criterion = "palette") {
  if (!files || !files.length) return;
  const importedPhotos = [];
  for (const file of Array.from(files).slice(0, 40)) {
    try {
      const image = await fileToCanvasSource(file);
      const analysis = analyzePalette(image);
      const metadata = await parsePhotoMetadata(file);
      importedPhotos.unshift({
        id: `user-${Date.now()}-${Math.random()}`,
        isSample: false,
        name: cleanName(file.name),
        source: image,
        paletteKey: analysis.collectionId,
        paletteLabel: analysis.paletteLabel,
        sceneLabel: analysis.sceneLabel,
        dominantColor: analysis.dominantColor,
        timeLabel: metadata.timeLabel,
        timeKey: metadata.timeKey,
        timeSource: metadata.timeSource,
        locationLabel: metadata.locationLabel,
        locationKey: metadata.locationKey,
        locationSource: metadata.locationSource,
        gps: metadata.gps,
        manualGroupByCriterion: {}
      });
    } catch {
      continue;
    }
  }
  closeImportModal();
  filePicker.value = "";
  if (!importedPhotos.length) {
    showNotice(IMPORT_UNREADABLE_TEXT);
    return;
  }
  if (!app.hasUserPhotos) {
    allPhotos = allPhotos.filter((photo) => !photo.isSample);
    app.hasUserPhotos = true;
  }
  allPhotos.unshift(...importedPhotos);
  app.currentCriterion = criterion;
  regroupCollections(app.currentCriterion);
  updateCaption();
}

function showNotice(message) {
  clearTimeout(noticeTimer);
  error.textContent = message || ERROR_TEXT;
  error.classList.add("show");
  noticeTimer = setTimeout(() => {
    error.classList.remove("show");
    error.textContent = ERROR_TEXT;
  }, 2600);
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

async function fileToCanvasSource(file) {
  const decoded = await decodeImageFile(file);
  try {
    return normalizeImageSource(decoded);
  } finally {
    if (decoded && typeof decoded.close === "function") decoded.close();
  }
}

async function decodeImageFile(file) {
  try {
    return await decodeBrowserReadableBlob(file);
  } catch {
    const heicDecoder = getHeicDecoder();
    if (isHeicFile(file) && heicDecoder) {
      const converted = await heicDecoder({
        blob: file,
        toType: "image/png",
        quality: 0.9,
        multiple: false
      });
      const convertedBlob = Array.isArray(converted) ? converted[0] : converted;
      return decodeBrowserReadableBlob(convertedBlob);
    }
    throw new Error("image decode failed");
  }
}

async function decodeBrowserReadableBlob(blob) {
  if ("createImageBitmap" in globalThis) {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // Some WebViews decode formats through <img> even when createImageBitmap cannot.
    }
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.addEventListener("load", () => {
      URL.revokeObjectURL(url);
      resolve(image);
    }, { once: true });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    }, { once: true });
    image.src = url;
  });
}

function isHeicFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/.test(name);
}

function getHeicDecoder() {
  if (typeof globalThis.heic2any === "function") return globalThis.heic2any;
  if (globalThis.self && typeof globalThis.self.heic2any === "function") return globalThis.self.heic2any;
  return null;
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
