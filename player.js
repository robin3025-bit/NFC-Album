const definitions = [
  ["dark", "클래식 다크", "#141414", "#343434", "#242424", "#fff", "#ddd", "#555", 12],
  ["sunset", "선셋 핑크", "#65204d", "#a63f60", "#582444", "#fff2f5", "#ffb697", "#ba6984", 26],
  ["ocean", "오션 블루", "#07304a", "#17687a", "#154b61", "#edfaff", "#76f1e4", "#44a9b8", 18],
  ["forest", "포레스트 그린", "#102f24", "#41613c", "#234331", "#f3ffe8", "#c6e68b", "#73965d", 9],
  ["lavender", "라벤더 드림", "#e4d8fa", "#f8e7f7", "#f8f0ff", "#392850", "#65469b", "#b99be4", 24],
  ["cherry", "벚꽃 무드", "#fce0e5", "#fff3f2", "#fff5fa", "#682d48", "#993d64", "#e895ad", 30],
  ["vintage", "빈티지 브라운", "#472b20", "#704936", "#583c30", "#fff0d8", "#efbe7f", "#b4835e", 4],
  ["cassette", "카세트 베이지", "#d5ba95", "#f2e2c2", "#f6e9cb", "#392c21", "#6a4528", "#aa8060", 7],
  ["lp", "LP 클래식", "#1b1924", "#3b1826", "#292230", "#fbf1f5", "#ff6c76", "#875463", 48],
  ["navy", "미드나잇 네이비", "#0e142d", "#253560", "#1d2a4b", "#f2f5ff", "#a9b8ff", "#596a9c", 14],
  ["gold", "블랙 골드", "#151108", "#30291a", "#242015", "#fff3cd", "#eec466", "#a6873c", 3],
  ["coral", "코랄 피치", "#ffb199", "#ffe3bb", "#ffebd9", "#5a2e26", "#9e3d37", "#e98772", 20],
  ["mint", "민트 프레시", "#b9f0dc", "#eaffed", "#edfff6", "#134a39", "#24654d", "#69ae96", 16],
  ["cream", "크림 베이지", "#eee1c8", "#fffaf0", "#fffaf3", "#51402e", "#725539", "#baa07c", 11],
  ["garden", "플라워 가든", "#dceab8", "#f1d3e5", "#fcf7e7", "#363929", "#536c36", "#8c9b65", 22],
  ["moon", "문라이트 블루", "#293955", "#59729a", "#35476a", "#f0f7ff", "#c4e5ff", "#819cc3", 32]
];
const light = new Set(["lavender", "cherry", "cassette", "coral", "mint", "cream", "garden"]);
const patterns = [
  "linear-gradient(transparent,transparent)",
  "radial-gradient(circle at 22% 14%,#fff4,transparent 46%)",
  "repeating-linear-gradient(135deg,transparent 0 9px,#fff1 10px 11px)",
  "radial-gradient(circle at 25% 25%,#fff2 1px,transparent 2px) 0 0 / 13px 13px",
];
export const themes = new Map(definitions.map(([id, label, start, end, surface, ink, accent, frame, radius], i) =>
  [id, { label, vars: { bg: `linear-gradient(145deg,${start},${end})`, surface, ink, accent, frame,
    radius: `${radius}px`, on: light.has(id) ? "#fff" : "#16131c", texture: patterns[i % patterns.length] } }]));
export function applyTheme(element, id) {
  const theme = themes.get(id) ?? themes.get("dark");
  for (const [name, value] of Object.entries(theme.vars)) element.style.setProperty("--" + name, value);
  element.dataset.theme = themes.has(id) ? id : "dark";
}
const clock = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00";
export function mountPlayer(root) {
  root.className = "player";
  root.innerHTML = `<h1></h1><div class="frame"><span class="placeholder" aria-hidden="true">♫</span><img hidden></div>
    <div class="photo-controls"><button type="button" aria-label="이전 사진">‹</button><span></span><button type="button" aria-label="다음 사진">›</button></div>
    <h2></h2><input class="seek" aria-label="재생 위치" type="range" min="0" max="1" step=".1" value="0" disabled>
    <div class="time"><span>0:00</span><span>0:00</span></div>
    <div class="transport"><button type="button">이전 곡</button><button type="button" class="accent">재생</button><button type="button">다음 곡</button></div>
    <p class="player-error" role="status" hidden></p><strong>플레이리스트</strong><ol class="playlist"></ol><audio preload="metadata"></audio>`;
  const find = s => root.querySelector(s);
  const [previous, toggle, next] = root.querySelectorAll(".transport button");
  const [backPhoto, forwardPhoto] = root.querySelectorAll(".photo-controls button");
  const [elapsed, duration] = root.querySelectorAll(".time span");
  const audio = find("audio"), img = find("img"), seek = find(".seek"), error = find(".player-error");
  let album = {tracks: [], photos: []}, track = 0, photo = 0, trackSrc, photoSrc;
  function notice(message) { error.textContent = message; error.hidden = !message; }
  async function play() {
    try { await audio.play(); }
    catch (e) { if (e.name !== "AbortError") notice("음악을 재생할 수 없습니다. 파일 형식 또는 공유 상태를 확인하세요."); }
  }
  function showPhoto() {
    const item = album.photos[photo];
    img.hidden = !item;
    find(".placeholder").hidden = !!item;
    if (item) {
      img.alt = `앨범 사진 ${photo + 1}`;
      img.onerror = () => { img.hidden = true; find(".placeholder").hidden = false; };
      if (img.getAttribute("src") !== item.src) img.src = item.src;
    } else img.removeAttribute("src");
    photoSrc = item?.src;
    backPhoto.disabled = forwardPhoto.disabled = album.photos.length < 2;
    find(".photo-controls span").textContent = item ? `${photo + 1} / ${album.photos.length}` : "사진 없음";
  }
  function showTrack() {
    const song = album.tracks[track];
    find("h2").textContent = song?.title || (song ? "제목 없는 곡" : "등록된 음악이 없습니다");
    if (song?.src !== trackSrc) {
      notice("");
      if (song) audio.src = song.src;
      else { audio.pause(); audio.removeAttribute("src"); audio.load(); }
      trackSrc = song?.src;
      seek.disabled = true;
      seek.value = 0;
      elapsed.textContent = duration.textContent = "0:00";
    }
    toggle.disabled = !song;
    previous.disabled = next.disabled = album.tracks.length < 2;
    find(".playlist").replaceChildren(...album.tracks.map((song, index) => {
      const li = document.createElement("li"), button = document.createElement("button");
      button.type = "button"; button.textContent = `${index + 1}. ${song.title || "제목 없는 곡"}`;
      if (index === track) button.setAttribute("aria-current", "true");
      button.onclick = () => selectTrack(index, true);
      li.append(button);
      return li;
    }));
  }
  function selectTrack(index, autoplay) {
    track = (index + album.tracks.length) % album.tracks.length;
    showTrack();
    if (autoplay) void play();
  }
  function movePhoto(step) { photo = (photo + step + album.photos.length) % album.photos.length; showPhoto(); }
  backPhoto.onclick = () => movePhoto(-1);
  forwardPhoto.onclick = () => movePhoto(1);
  previous.onclick = () => selectTrack(track - 1, !audio.paused);
  next.onclick = () => selectTrack(track + 1, !audio.paused);
  toggle.onclick = () => audio.paused ? void play() : audio.pause();
  for (const event of ["play", "pause", "ended", "emptied"]) {
    audio.addEventListener(event, () => { toggle.textContent = audio.paused || audio.ended ? "재생" : "일시정지"; });
  }
  audio.onended = () => { if (track + 1 < album.tracks.length) selectTrack(track + 1, true); };
  audio.onerror = () => { if (trackSrc) notice("음악을 불러올 수 없습니다. 파일 형식 또는 공유 상태를 확인하세요."); };
  const syncTime = () => {
    seek.disabled = !Number.isFinite(audio.duration) || audio.duration <= 0;
    seek.max = seek.disabled ? 1 : audio.duration;
    seek.value = audio.currentTime || 0;
    elapsed.textContent = clock(audio.currentTime); duration.textContent = clock(audio.duration);
  };
  audio.ontimeupdate = audio.ondurationchange = syncTime;
  seek.oninput = () => { if (!seek.disabled) audio.currentTime = Number(seek.value); };
  return nextAlbum => {
    track = Math.max(0, nextAlbum.tracks.findIndex(song => song.src === trackSrc));
    photo = Math.max(0, nextAlbum.photos.findIndex(item => item.src === photoSrc));
    album = nextAlbum;
    find("h1").textContent = album.title || "나의 음악 앨범";
    applyTheme(root, album.theme);
    showPhoto();
    showTrack();
  };
}
