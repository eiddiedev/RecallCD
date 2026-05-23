import * as THREE from "./three.module.min.js";
import { heicTo, isHeic } from "./heic-to.local.js";
import {
  analyzePalette,
  classifyPhoto,
  getCriterionLabel,
  makeAdaptivePalette,
  parsePhotoMetadata
} from "./classifier.js";

const ERROR_TEXT = "哎呀，出错了，请重启试试吧~";
const IMPORT_UNREADABLE_TEXT = "这批照片暂时无法读取，请换一张或转成 JPG/PNG 再试试";
const STORAGE_KEY = "recallcd.userLibrary.v1";
const DB_NAME = "recallcd-library";
const DB_STORE = "library";
const sceneCanvas = document.getElementById("scene");
const detail = document.getElementById("detail");
const detailCanvas = document.getElementById("detailCanvas");
const importBtn = document.getElementById("importBtn");
const deleteCdBtn = document.getElementById("deleteCdBtn");
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
const tabBar = document.getElementById("tabBar");
const tabButtons = Array.from(tabBar.querySelectorAll("[data-tab]"));
const tabIndicator = document.getElementById("tabIndicator");
const assignLocationBtn = document.getElementById("assignLocationBtn");
const locationModal = document.getElementById("locationModal");
const locationInput = document.getElementById("locationInput");
const saveLocationBtn = document.getElementById("saveLocationBtn");
const cancelLocationBtn = document.getElementById("cancelLocationBtn");

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
  drawerIndex: -1,
  selectedPhotos: new Set(),
  detailCtx: detailCanvas.getContext("2d")
};

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

async function boot() {
  try {
    await restoreSavedLibrary();
    collections = buildCollections(app.currentCriterion);
    setupThree();
    setupEvents();
    updateCaption();
    updateTabIndicator();
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
  app.titlePlane = createTitlePlane(collections[0] || { title: "记忆CD" });
  resize();
}

function createCaseGroup(collection, index) {
  const group = new THREE.Group();
  group.userData = { collectionId: collection.id, index };

  const coverTexture = makeCoverTexture(collection);
  const mainSpineTexture = makeSideTexture(collection, collection.sideLabels[0], "spine", true);
  const locationSpineTexture = makeSideTexture(collection, collection.sideLabels[1], "spine", true, true);
  const backTexture = makeTextTexture(collection, "back");
  const timeSpineTexture = makeFrontSpineTexture(collection, collection.sideLabels[2], false);
  const deviceSpineTexture = makeFrontSpineTexture(collection, collection.sideLabels[3], false, true);
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
  c.rotate(Math.PI / 2);
  c.textBaseline = "middle";
  c.fillStyle = collection.palette.text;
  c.textAlign = "center";
  c.font = `${emphasis ? 700 : 500} ${mode === "spine" ? (emphasis ? 48 : 44) : (emphasis ? 56 : 44)}px "Helvetica Neue", "PingFang SC", Helvetica, "Songti SC", Georgia, serif`;
  c.fillText(label, 0, 0, canvas.height - 200);
  c.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (opposite) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, -1);
    texture.offset.set(0, 1);
  }
  return texture;
}

function makeFrontSpineTexture(collection, label = collection.spine, emphasis = false, opposite = false) {
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
  c.font = `${emphasis ? 700 : 500} ${emphasis ? 52 : 44}px "Helvetica Neue", "PingFang SC", Helvetica, "Songti SC", Georgia, serif`;
  c.fillText(label, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 80);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (opposite) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, -1);
    texture.offset.set(0, 1);
  }
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
  updateTabIndicator();
  drawDetail();
}

function setupEvents() {
  addEventListener("resize", resize, { passive: true });
  sceneCanvas.addEventListener("pointerdown", onPointerDown, { passive: true });
  sceneCanvas.addEventListener("pointermove", onPointerMove, { passive: true });
  sceneCanvas.addEventListener("pointerup", onPointerUp, { passive: true });
  sceneCanvas.addEventListener("pointercancel", () => { app.drag = null; }, { passive: true });
  sceneCanvas.addEventListener("wheel", onWheel, { passive: false });
  importBtn.addEventListener("click", () => filePicker.click());
  deleteCdBtn.addEventListener("click", deleteCurrentCollection);
  tabButtons.forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  backBtn.addEventListener("click", () => closeDetail());
  filePicker.addEventListener("change", () => handleFiles(filePicker.files));
  drawerGrid.addEventListener("click", onDrawerClick);
  drawerGrid.addEventListener("mouseover", onDrawerHover);
  drawerGrid.addEventListener("mouseleave", () => updateCaption());
  assignLocationBtn.addEventListener("click", () => openLocationModal());
  saveLocationBtn.addEventListener("click", () => saveLocationAssignment());
  cancelLocationBtn.addEventListener("click", () => closeLocationModal());
}

function switchTab(criterion) {
  if (!["palette", "location", "time"].includes(criterion) || criterion === app.currentCriterion) return;
  app.currentCriterion = criterion;
  tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.tab === criterion));
  updateTabIndicator();
  regroupCollections(criterion, null, false);
  saveUserLibrary();
}

function updateTabIndicator() {
  const active = tabBar.querySelector("button.active");
  if (!active || !tabIndicator) return;
  const barRect = tabBar.getBoundingClientRect();
  const btnRect = active.getBoundingClientRect();
  tabIndicator.style.width = `${btnRect.width * 0.52}px`;
  tabIndicator.style.left = `${btnRect.left - barRect.left + (btnRect.width - btnRect.width * 0.52) / 2}px`;
}

function updateAssignLocationBtn() {
  assignLocationBtn.classList.toggle("show", app.currentCriterion === "location" && app.selectedPhotos.size > 0);
}

function openLocationModal() {
  locationInput.value = "";
  locationModal.classList.add("open");
  locationInput.focus();
}

function closeLocationModal() {
  locationModal.classList.remove("open");
}

function saveLocationAssignment() {
  const locationName = locationInput.value.trim();
  if (!locationName) return;
  const collection = collections[app.drawerIndex];
  if (!collection) {
    console.warn("No collection at drawerIndex", app.drawerIndex);
    return;
  }
  const locationKey = "loc-manual-" + encodeURIComponent(locationName.toLowerCase());
  app.selectedPhotos.forEach((photoIndex) => {
    const photo = collection.photos[photoIndex];
    if (photo) {
      if (!photo.manualGroupByCriterion) photo.manualGroupByCriterion = {};
      photo.manualGroupByCriterion.location = { key: locationKey, title: locationName };
      photo.locationLabel = locationName;
      photo.locationKey = locationKey;
      photo.locationSource = "manual";
    }
  });
  closeLocationModal();
  app.selectedPhotos.clear();
  regroupCollections(app.currentCriterion, locationKey, true);
  saveUserLibrary();
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
  updateCaption();
}

function syncPresentationClass() {
  const collection = collections[app.selectedIndex] || collections[0];
  const presenting = Boolean(app.flippedId && innerHeight >= innerWidth && collection);
  document.body.classList.toggle("presenting", presenting);
  if (collection && albumTitleLayer) albumTitleLayer.querySelector("strong").textContent = collection.title;
  if (collection) updateTitlePlane(collection);
}

function renderDrawer(index) {
  const collection = collections[index] || collections[0];
  if (!collection) return;
  app.drawerIndex = index;
  app.selectedPhotos.clear();
  updateAssignLocationBtn();
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
  if (app.currentCriterion === "location") return photo.locationLabel || "未知地点";
  if (app.currentCriterion === "time") return photo.timeLabel || "未知时间";
  return photo.paletteLabel;
}

function hideDrawer() {
  photoDrawer.classList.remove("open");
  app.selectedPhotos.clear();
  updateAssignLocationBtn();
}

function deleteCurrentCollection() {
  void deleteCurrentCollectionAsync();
}

async function deleteCurrentCollectionAsync() {
  const collection = collections[app.selectedIndex] || collections[0];
  if (!collection) return;
  const ids = new Set(collection.photos.map((photo) => photo.id));
  allPhotos = allPhotos.filter((photo) => !ids.has(photo.id));
  app.flippedId = null;
  if (!allPhotos.length) {
    await removeStoredLibrary();
  } else {
    await saveUserLibrary();
  }
  regroupCollections(app.currentCriterion, null, false);
  showNotice(`已删除 ${collection.title}`);
}

function onDrawerClick(event) {
  const button = event.target.closest(".photo-thumb");
  if (!button) return;
  const photoIndex = Number(button.dataset.photoIndex || 0);
  if (app.currentCriterion === "location") {
    if (app.selectedPhotos.has(photoIndex)) {
      app.selectedPhotos.delete(photoIndex);
      button.classList.remove("selected");
    } else {
      app.selectedPhotos.add(photoIndex);
      button.classList.add("selected");
    }
    updateAssignLocationBtn();
    return;
  }
  app.drawerPhoto = photoIndex;
  app.detailPhoto = app.drawerPhoto;
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
      const firstColor = photos[0]?.dominantColor || "#8a6a55";
      return makeCollection(info.key, info.title, info.spine, makeAdaptivePalette(firstColor), photos, criterion);
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
  const grd = ctx.createLinearGradient(x, y + h * 0.45, x, y + h);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,.72)");
  ctx.fillStyle = grd;
  ctx.fillRect(x, y, w, h);
  text(ctx, photo.name, x + 26, y + h - 68, 22, "#fff8ec", 900, "left", "Georgia");
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
    tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.tab === app.currentCriterion));
    return true;
  } catch (err) {
    console.warn("Saved library restore failed", err);
    await removeStoredLibrary();
    return false;
  }
}

async function saveUserLibrary() {
  try {
    const photos = allPhotos
      .slice(0, 60)
      .map((photo) => ({
        id: photo.id,
        name: photo.name,
        storedDataUrl: photo.storedDataUrl || sourceToStorageDataUrl(photo.source),
        criterionSource: photo.criterionSource || "palette",
        paletteKey: photo.paletteKey,
        paletteLabel: photo.paletteLabel,
        sceneLabel: photo.sceneLabel,
        dominantColor: photo.dominantColor,
        timeLabel: photo.timeLabel,
        timeKey: photo.timeKey,
        timeSource: photo.timeSource,
        locationLabel: photo.locationLabel,
        locationKey: photo.locationKey,
        locationSource: photo.locationSource,
        deviceLabel: photo.deviceLabel,
        deviceKey: photo.deviceKey,
        gps: photo.gps || null,
        manualGroupByCriterion: photo.manualGroupByCriterion || {}
      }));
    if (!photos.length) {
      await removeStoredLibrary();
      return;
    }
    await writeStoredLibrary({
      currentCriterion: app.currentCriterion,
      savedAt: Date.now(),
      photos
    });
  } catch (err) {
    console.warn("Saved library write failed", err);
    showNotice("照片已导入，但本地空间不足，刷新后可能不会保留", 3600);
  }
}

function readStoredLibrary() {
  return withLibraryStore("readonly", (store) => requestToPromise(store.get(STORAGE_KEY)))
    .catch(() => {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    });
}

async function writeStoredLibrary(payload) {
  try {
    await withLibraryStore("readwrite", (store) => requestToPromise(store.put(payload, STORAGE_KEY)));
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
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

async function handleFiles(files) {
  const criterion = app.currentCriterion;
  if (!files || !files.length) return;
  const importedPhotos = [];
  const failures = [];
  for (const file of Array.from(files).slice(0, 40)) {
    try {
      const image = await fileToCanvasSource(file);
      const analysis = analyzePalette(image);
      const metadata = await parsePhotoMetadata(file);
      const storedDataUrl = sourceToStorageDataUrl(image);
      importedPhotos.unshift({
        id: `user-${Date.now()}-${Math.random()}`,
        name: cleanName(file.name),
        source: image,
        storedDataUrl,
        criterionSource: criterion,
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
        deviceLabel: metadata.deviceLabel,
        deviceKey: metadata.deviceKey,
        gps: metadata.gps,
        manualGroupByCriterion: {}
      });
    } catch (err) {
      failures.push(`${file.name || "照片"}：${err?.message || "无法解码"}`);
      continue;
    }
  }
  filePicker.value = "";
  if (!importedPhotos.length) {
    showNotice(failures[0] || IMPORT_UNREADABLE_TEXT, 4200);
    return;
  }
  allPhotos.unshift(...importedPhotos);
  await saveUserLibrary();
  if (app.currentCriterion === "location") {
    const importedIds = new Set(importedPhotos.map((p) => p.id));
    openLocationModal();
    regroupCollections("location", "unknown-location", true);
    const ci = app.drawerIndex;
    const collection = collections[ci];
    if (collection) {
      collection.photos.forEach((photo, pi) => {
        if (importedIds.has(photo.id)) app.selectedPhotos.add(pi);
      });
      updateAssignLocationBtn();
    }
  } else {
    regroupCollections(app.currentCriterion, null, false);
  }
  updateCaption();
  if (failures.length) showNotice(`已导入 ${importedPhotos.length} 张，${failures.length} 张失败：${failures[0]}`, 4200);
}

function showNotice(message, duration = 2600) {
  clearTimeout(noticeTimer);
  errorEl.textContent = message || ERROR_TEXT;
  errorEl.classList.add("show");
  noticeTimer = setTimeout(() => {
    errorEl.classList.remove("show");
    errorEl.textContent = ERROR_TEXT;
  }, duration);
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
  } catch (nativeErr) {
    if (await shouldUseHeicDecoder(file)) {
      try {
        const convertedBlob = await heicTo({
          blob: file,
          type: "image/jpeg",
          quality: 0.86
        });
        return decodeBrowserReadableBlob(convertedBlob);
      } catch (heicErr) {
        throw new Error(`HEIC 转码失败：${formatDecodeError(heicErr)}`);
      }
    }
    throw new Error(`图片解码失败：${formatDecodeError(nativeErr)}`);
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

async function shouldUseHeicDecoder(file) {
  if (isHeicFile(file)) return true;
  try {
    return await isHeic(file);
  } catch {
    return false;
  }
}

function formatDecodeError(err) {
  return String(err?.message || err || "未知原因").replace(/^Error:\s*/, "").slice(0, 80);
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

function sourceToStorageDataUrl(source) {
  const maxSide = 1280;
  const sw = source.width || 1;
  const sh = source.height || 1;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
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
  errorEl.textContent = err?.message || ERROR_TEXT;
  errorEl.classList.add("show");
  console.error(err);
}

boot();
