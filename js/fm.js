// B-SIDE FM – Private Music Video Radio Module
// DeepSeek V4 powered music recommendation engine

import { DEEPSEEK_API_KEY } from "./config.js";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

const BEHAVIOR_KEY = "bside.fm.behavior.v1";

const STATIONS = [
  {
    id: "rain-night",
    title: "雨夜 FM",
    subtitle: "低速 · 女声 · Live · 城市夜景",
    insight: "B-SIDE 发现你最近更常收藏低 BPM、夜晚氛围和现场感强的视频。",
    scene: "适合睡前、通勤、独处",
    confidence: 86,
    videos: [
      {
        title: "雨夜里的 City Pop 现场",
        type: "LIVE",
        duration: "03:24",
        reason: "鼓点很轻，适合把一天慢慢降速。",
        memory: "副歌前那一下贝斯进入很有画面感。",
        tags: ["City Pop", "Live", "雨夜"],
        link: ""
      },
      {
        title: "深夜电台翻唱合集",
        type: "COVER",
        duration: "05:12",
        reason: "人声贴耳，像有人在旁边轻声唱歌。",
        memory: "第三首的和声突然拉开空间感。",
        tags: ["翻唱", "女声", "深夜"],
        link: ""
      },
      {
        title: "窗外在下雨的 Lo-fi 片段",
        type: "PLAYLIST",
        duration: "02:48",
        reason: "雨声和键盘声叠在一起很安心。",
        memory: "中间有一段猫咪走过的画面。",
        tags: ["Lo-fi", "雨声", "治愈"],
        link: ""
      },
      {
        title: "安静的钢琴 Live 片段",
        type: "LIVE",
        duration: "04:01",
        reason: "只有钢琴和呼吸声，很干净。",
        memory: "最后一个音符消散的方式很特别。",
        tags: ["钢琴", "Live", "安静"],
        link: ""
      }
    ]
  },
  {
    id: "commute",
    title: "通勤 FM",
    subtitle: "中速 · 节奏感 · 电子 · 城市",
    insight: "B-SIDE 注意到你在工作日早上偏好节奏明快、带有电子元素的视频。",
    scene: "适合通勤、运动、提神",
    confidence: 79,
    videos: [
      {
        title: "地铁上的 Synth Pop 现场",
        type: "LIVE",
        duration: "03:56",
        reason: "合成器的脉冲感刚好配得上地铁的节奏。",
        memory: "灯光打在乐手脸上那一帧很好看。",
        tags: ["Synth Pop", "Live", "通勤"],
        link: ""
      },
      {
        title: "城市骑行 BGM 合集",
        type: "PLAYLIST",
        duration: "06:30",
        reason: "速度感很强，但不会让人焦虑。",
        memory: "有一段穿过隧道的画面转换很丝滑。",
        tags: ["电子", "骑行", "城市"],
        link: ""
      },
      {
        title: "独立乐队排练室录像",
        type: "REVIEW",
        duration: "04:15",
        reason: "排练室的声音比正式版更有呼吸感。",
        memory: "鼓手笑场的那一秒特别真实。",
        tags: ["独立", "排练", "真实"],
        link: ""
      }
    ]
  },
  {
    id: "live-wild",
    title: "现场 FM",
    subtitle: "高能 · 乐队 · 呐喊 · 不插电",
    insight: "B-SIDE 发现你收藏了不少现场演出视频，尤其是观众互动强烈的片段。",
    scene: "适合兴奋、需要能量、想嗨",
    confidence: 91,
    videos: [
      {
        title: "万人合唱的音乐节瞬间",
        type: "LIVE",
        duration: "02:58",
        reason: "人声浪涌起来的时候会起鸡皮疙瘩。",
        memory: "镜头从舞台拉到人群那一刻很震撼。",
        tags: ["音乐节", "合唱", "现场"],
        link: ""
      },
      {
        title: "不插电版经典摇滚",
        type: "COVER",
        duration: "04:42",
        reason: "木吉他的颗粒感让老歌有了新味道。",
        memory: "副歌时歌手闭眼的方式很有感染力。",
        tags: ["不插电", "摇滚", "翻唱"],
        link: ""
      },
      {
        title: "地下 Live House 午夜场",
        type: "LIVE",
        duration: "05:20",
        reason: "空间小，声音密度高，很近很真。",
        memory: "贝斯手的琴弦反光在烟雾里很好看。",
        tags: ["地下", "Live House", "午夜"],
        link: ""
      },
      {
        title: "乐队排练时的意外即兴",
        type: "LIVE",
        duration: "03:10",
        reason: "计划外的东西往往最有生命力。",
        memory: "吉他手和鼓手对视那一瞬间的默契。",
        tags: ["即兴", "排练", "默契"],
        link: ""
      },
      {
        title: "街头路演完整录像",
        type: "REVIEW",
        duration: "06:08",
        reason: "路人的反应比舞台上的灯光更真实。",
        memory: "有个小朋友跟着节奏摇起来了。",
        tags: ["街头", "路演", "路人"],
        link: ""
      }
    ]
  },
  {
    id: "retro",
    title: "复古 FM",
    subtitle: "慢速 · 磁带感 · 老歌 · 怀旧",
    insight: "B-SIDE 发现你对带有年代质感的视频有明显偏好，尤其是磁带、黑胶和老式录音画面。",
    scene: "适合怀旧、放松、发呆",
    confidence: 83,
    videos: [
      {
        title: "80 年代 J-Pop MV 修复版",
        type: "MV",
        duration: "04:30",
        reason: "修复后的画质让老 MV 有了新的呼吸空间。",
        memory: "霓虹色调的片头字幕非常有时代感。",
        tags: ["80 年代", "J-Pop", "修复"],
        link: ""
      },
      {
        title: "黑胶唱片转动的 ASMR",
        type: "PLAYLIST",
        duration: "03:15",
        reason: "唱针落下的那一刻世界会安静下来。",
        memory: "唱片标签上的手写字很好看。",
        tags: ["黑胶", "ASMR", "安静"],
        link: ""
      },
      {
        title: "老式录音机播放磁带",
        type: "PLAYLIST",
        duration: "02:50",
        reason: "磁带的底噪本身就是一种音乐。",
        memory: "按键按下去的机械声很治愈。",
        tags: ["磁带", "录音机", "底噪"],
        link: ""
      },
      {
        title: "父母年代的卡拉 OK 录像",
        type: "REVIEW",
        duration: "05:00",
        reason: "那些不完美的演唱比修音后的真实太多。",
        memory: "有人唱到一半忘词笑了出来。",
        tags: ["卡拉 OK", "家庭", "真实"],
        link: ""
      }
    ]
  }
];

let currentStationIndex = 0;
let isOpen = false;
let isDistilling = false;
let lastCollectionsData = null;
let dynamicStations = null;
let currentPlayingIdx = -1;

// ── Behavior Tracker ──

const tracker = {
  data: null,

  init() {
    try {
      const raw = localStorage.getItem(BEHAVIOR_KEY);
      this.data = raw ? JSON.parse(raw) : this.emptyState();
    } catch {
      this.data = this.emptyState();
    }
    window.addEventListener("bside:behavior", (e) => this.record(e.detail));
  },

  emptyState() {
    return { cdOpens: {}, drawerOpens: {}, totalRedistills: 0, lastRedistillAt: null };
  },

  record(detail) {
    if (detail.type === "cd-open") {
      const entry = this.data.cdOpens[detail.collectionId] || { count: 0, lastOpened: 0 };
      entry.count++;
      entry.lastOpened = detail.timestamp;
      this.data.cdOpens[detail.collectionId] = entry;
    }
    if (detail.type === "drawer-open") {
      const entry = this.data.drawerOpens[detail.collectionId] || { count: 0, totalPhotos: 0 };
      entry.count++;
      entry.totalPhotos = detail.photoCount;
      this.data.drawerOpens[detail.collectionId] = entry;
    }
    this.persist();
  },

  recordRedistill() {
    this.data.totalRedistills++;
    this.data.lastRedistillAt = Date.now();
    this.persist();
  },

  persist() {
    try { localStorage.setItem(BEHAVIOR_KEY, JSON.stringify(this.data)); } catch {}
  },

  getTopGenres(limit = 5) {
    return Object.entries(this.data.cdOpens)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([id, info]) => ({ id, count: info.count, lastOpened: info.lastOpened }));
  }
};

tracker.init();

// ── Play ──

let currentAudio = null;

function getSearchQuery(title) {
  const raw = title.replace(/[""《》【】\[\]]/g, "").trim();
  const parts = raw.split(/\s*[-–—\/|]\s*/);
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0];
}

async function searchDeezer(keyword) {
  try {
    const res = await fetch(`http://localhost:3000/api/deezer?q=${encodeURIComponent(keyword)}`);
    const data = await res.json();
    return data.data?.[0] || null;
  } catch { return null; }
}

function playSong(idx) {
  const station = getStation();
  const v = station.videos[idx];
  if (!v) return;

  const playerWrap = document.getElementById("fmPlayer");
  const playerInfo = document.getElementById("fmPlayerInfo");
  const playBtns = document.querySelectorAll(".fm-card-play");

  // Toggle off if same song
  if (currentPlayingIdx === idx) {
    currentPlayingIdx = -1;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    playerWrap?.classList.remove("open");
    playBtns.forEach(b => b.classList.remove("playing"));
    return;
  }

  // Stop previous
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }

  currentPlayingIdx = idx;
  playBtns.forEach(b => b.classList.toggle("playing", Number(b.dataset.index) === idx));

  const query = getSearchQuery(v.title);
  playerInfo.innerHTML = `<div class="fm-player-loading">搜索中...</div>`;
  playerWrap?.classList.add("open");

  searchDeezer(query).then(track => {
    if (!track || currentPlayingIdx !== idx) return;

    const audio = new Audio(track.preview);
    currentAudio = audio;

    playerInfo.innerHTML = `
      <div class="fm-player-bar">
        <div class="fm-player-info">
          <span class="fm-player-name">${track.title}</span>
          <span class="fm-player-artist">${track.artist?.name || ""}</span>
        </div>
        <button class="fm-player-toggle" id="fmPlayerToggle">&#9646;&#9646;</button>
      </div>
    `;

    audio.play();
    document.getElementById("fmPlayerToggle")?.addEventListener("click", () => {
      if (audio.paused) { audio.play(); }
      else { audio.pause(); }
    });
    audio.addEventListener("ended", () => {
      currentPlayingIdx = -1;
      currentAudio = null;
      playerWrap?.classList.remove("open");
      playBtns.forEach(b => b.classList.remove("playing"));
    });
  });
}

// ── DeepSeek API ──

async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRecommendation() {
  const collectionsSummary = (lastCollectionsData || []).map(c =>
    `- ${c.title}（${c.spine}）: ${c.count} 个内容`
  ).join("\n") || "暂无收藏数据";

  const topGenres = tracker.getTopGenres(5);
  const behaviorSummary = topGenres.length
    ? topGenres.map(g => `- ${g.id}: 打开 ${g.count} 次`).join("\n")
    : "暂无行为数据";

  const selectedId = (dynamicStations || STATIONS)[currentStationIndex]?.id || "未知";

  const prompt = `你是 B-SIDE FM 的音乐推荐引擎。根据用户的音乐视频收藏和行为数据，生成一个私人电台推荐。

用户收藏概览：
${collectionsSummary}

用户行为偏好（按打开次数排序）：
${behaviorSummary}

当前选中的分类：${selectedId}

请生成一个电台推荐，要求：
1. 电台标题和副标题要贴合用户偏好的音乐风格
2. 推荐 3-5 首真实的中文或国际歌曲，格式为"歌曲名 - 艺术家"
3. 每首歌需要有推荐理由（简短、感性、像朋友推荐）
4. 每首歌需要有一个"记忆点"（与听歌场景相关的画面描述）

请严格按以下 JSON 格式返回，不要包含其他文字：
{
  "id": "ai-station",
  "title": "电台名称",
  "subtitle": "风格关键词 · 用 · 分隔",
  "insight": "AI 对用户收藏习惯的分析（1-2句话）",
  "scene": "适合的场景",
  "confidence": 85,
  "videos": [
    {
      "title": "歌曲名 - 艺术家",
      "type": "MV",
      "duration": "04:30",
      "reason": "推荐理由",
      "memory": "记忆点描述",
      "tags": ["标签1", "标签2"]
    }
  ]
}`;

  const response = await fetchWithTimeout(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: "你是 B-SIDE FM 音乐推荐引擎。只返回 JSON，不要返回其他文字。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 1500,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content);

  return {
    id: parsed.id || "ai-station",
    title: parsed.title || "AI 电台",
    subtitle: parsed.subtitle || "AI 生成",
    insight: parsed.insight || "基于你的收藏习惯生成",
    scene: parsed.scene || "适合随时聆听",
    confidence: parsed.confidence || 80,
    videos: (parsed.videos || []).slice(0, 5).map(v => ({
      title: v.title || "未知歌曲",
      type: v.type || "MV",
      duration: v.duration || "--:--",
      reason: v.reason || "",
      memory: v.memory || "",
      tags: Array.isArray(v.tags) ? v.tags : []
    }))
  };
}

// ── Station Logic ──

function getStations() {
  return dynamicStations || STATIONS;
}

function getStation() {
  return getStations()[currentStationIndex];
}

function open(detail) {
  if (isOpen) return;
  isOpen = true;
  lastCollectionsData = detail?.collections || null;

  if (detail?.collections?.length) {
    dynamicStations = detail.collections.map(c => ({
      id: c.id,
      title: c.title,
      subtitle: `${c.count} 个内容`,
      insight: `你在「${c.title}」分类中有 ${c.count} 个内容。点击「重新蒸馏」获取 AI 推荐。`,
      scene: "点击重新蒸馏获取推荐",
      confidence: 0,
      videos: []
    }));
  }

  if (detail?.selectedCollection) {
    const idx = getStations().findIndex(s => s.id === detail.selectedCollection);
    if (idx >= 0) currentStationIndex = idx;
  }

  render();
  requestAnimationFrame(() => {
    const el = document.getElementById("fmOverlay");
    if (el) el.classList.add("open");
  });
}

function close() {
  const el = document.getElementById("fmOverlay");
  if (el) el.classList.remove("open");
  currentPlayingIdx = -1;
  setTimeout(() => {
    isOpen = false;
    const container = document.getElementById("fmContainer");
    if (container) container.innerHTML = "";
  }, 420);
}

async function redistill() {
  if (isDistilling) return;
  isDistilling = true;

  const cardsEl = document.getElementById("fmCards");
  const btn = document.getElementById("fmRedistill");
  if (btn) btn.disabled = true;
  tracker.recordRedistill();

  if (cardsEl) {
    cardsEl.innerHTML = Array.from({ length: 3 }, () =>
      `<div class="fm-card fm-card--loading"><div class="fm-shimmer"></div></div>`
    ).join("");
  }

  try {
    const station = await fetchRecommendation();
    const stations = getStations();
    stations[currentStationIndex] = station;
    if (dynamicStations) dynamicStations = stations;
    isDistilling = false;
    if (btn) btn.disabled = false;
    renderCards();
    renderInsight();
  } catch (err) {
    console.warn("DeepSeek API failed, falling back to mock:", err);
    let next = currentStationIndex;
    const fallback = STATIONS;
    while (next === currentStationIndex && fallback.length > 1) {
      next = Math.floor(Math.random() * fallback.length);
    }
    currentStationIndex = next;
    isDistilling = false;
    if (btn) btn.disabled = false;
    renderCards();
    renderInsight();
  }
}

// ── Rendering ──

function render() {
  const container = document.getElementById("fmContainer");
  if (!container) return;

  container.innerHTML = `
    <button class="fm-close" id="fmClose" aria-label="关闭 FM">&times;</button>
    <div class="fm-hero">
      <img class="fm-hero-logo" src="./images/fm-logo.png" alt="B-SIDE FM">
      <h2 class="fm-hero-title">B-SIDE FM</h2>
      <span class="fm-hero-sub">私人音乐推荐</span>
    </div>
    <div class="fm-insight" id="fmInsight"></div>
    <div class="fm-cards" id="fmCards"></div>
    <div class="fm-footer">
      <button class="fm-redistill" id="fmRedistill">
        <span class="fm-redistill-icon">&#9881;</span> 重新蒸馏
      </button>
      <p class="fm-footer-note">基于你的收藏习惯自动生成</p>
    </div>
    <div class="fm-player" id="fmPlayer">
      <div class="fm-player-inner" id="fmPlayerInfo"></div>
    </div>
  `;

  renderInsight();
  renderCards();

  document.getElementById("fmClose")?.addEventListener("click", close);
  document.getElementById("fmRedistill")?.addEventListener("click", redistill);
}

function renderInsight() {
  const el = document.getElementById("fmInsight");
  if (!el) return;
  const station = getStation();
  if (!station) return;
  el.innerHTML = `
    <button class="fm-insight-toggle" id="fmInsightToggle" aria-label="查看 AI 分析">
      <span class="fm-insight-ai">AI 分析</span>
      <span class="fm-insight-i">i</span>
    </button>
    <div class="fm-popup-mask" id="fmInsightMask">
      <div class="fm-popup" id="fmInsightPopup">
        <div class="fm-insight-header">
          <span class="fm-insight-ai">AI 分析</span>
          <span class="fm-insight-conf">${station.confidence > 0 ? `置信度 ${station.confidence}%` : "待蒸馏"}</span>
        </div>
        <p class="fm-insight-text">${station.insight}</p>
        <p class="fm-insight-scene">${station.scene}</p>
      </div>
    </div>
  `;
  const toggle = document.getElementById("fmInsightToggle");
  const mask = document.getElementById("fmInsightMask");
  toggle?.addEventListener("click", () => mask?.classList.add("open"));
  mask?.addEventListener("click", (e) => {
    if (e.target === mask) mask.classList.remove("open");
  });
}

function renderCards() {
  const cardsEl = document.getElementById("fmCards");
  if (!cardsEl) return;
  const station = getStation();

  if (!station.videos.length) {
    cardsEl.innerHTML = `
      <div class="fm-empty">
        <p class="fm-empty-text">点击「重新蒸馏」让 AI 为你生成推荐</p>
      </div>
    `;
    return;
  }

  cardsEl.innerHTML = station.videos.map((v, i) => `
    <article class="fm-card" style="--delay: ${i * 0.08}s">
      <div class="fm-card-head">
        <span class="fm-card-type">${v.type}</span>
        <span class="fm-card-duration">${v.duration}</span>
      </div>
      <div class="fm-card-title-row">
        <h3 class="fm-card-title">${v.title}</h3>
        <button class="fm-card-info-btn" data-index="${i}" aria-label="查看详情">i</button>
      </div>
      <div class="fm-card-bottom">
        <div class="fm-card-tags">
          ${v.tags.map(t => `<span class="fm-card-tag">${t}</span>`).join("")}
        </div>
        <div class="fm-card-actions">
          <button class="fm-card-mv" data-index="${i}" title="观看 MV">MV</button>
          <button class="fm-card-play" data-index="${i}" title="播放">&#9654;</button>
        </div>
      </div>
    </article>
  `).join("");

  // Global card popups
  let popupsHtml = station.videos.map((v, i) => `
    <div class="fm-popup-mask" id="fmCardMask${i}">
      <div class="fm-popup">
        <p class="fm-card-reason">${v.reason}</p>
        <div class="fm-card-memory">
          <span class="fm-card-memory-label">记忆点</span>
          <p class="fm-card-memory-text">${v.memory}</p>
        </div>
      </div>
    </div>
  `).join("");
  let popupsContainer = document.getElementById("fmCardPopups");
  if (!popupsContainer) {
    popupsContainer = document.createElement("div");
    popupsContainer.id = "fmCardPopups";
    document.getElementById("fmContainer")?.appendChild(popupsContainer);
  }
  popupsContainer.innerHTML = popupsHtml;

  // Bind info buttons
  cardsEl.querySelectorAll(".fm-card-info-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const mask = document.getElementById(`fmCardMask${btn.dataset.index}`);
      if (mask) mask.classList.add("open");
    });
  });
  popupsContainer.querySelectorAll(".fm-popup-mask").forEach(mask => {
    mask.addEventListener("click", (e) => {
      if (e.target === mask) mask.classList.remove("open");
    });
  });
  cardsEl.querySelectorAll(".fm-card-play").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      playSong(Number(btn.dataset.index));
    });
  });
  cardsEl.querySelectorAll(".fm-card-mv").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const station = getStation();
      const v = station.videos[Number(btn.dataset.index)];
      if (!v) return;
      const query = getSearchQuery(v.title) + " mv";
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, "_blank");
    });
  });
}

// ── Event Listener ──

window.addEventListener("bside:fm-open", (event) => {
  open(event.detail);
});
