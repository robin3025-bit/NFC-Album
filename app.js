import { applyTheme, loadThemes, mountPlayer, themes } from "./player.js";
import * as drive from "./drive.js";

const get = id => document.getElementById(id);
const status = message => { get("status").textContent = message; };
const updatePlayer = mountPlayer(get("player"));
const query = new URLSearchParams(location.search);
const categories = await loadThemes().catch(() => new Map());
const preview = get("preview");
preview.hidden = false;
const defaultTheme = categories.values().next().value?.ids[0] ?? "dark";
const blank = () => ({ title: "", theme: defaultTheme, tracks: [], photos: [] });

async function withSources(album, editor = false) {
  const created = [];
  async function resolve(item) {
    const src = editor && !drive.hasPublicKey() ? await drive.loadEditorMedia(item) : drive.mediaUrl(item).href;
    if (src.startsWith("blob:")) created.push(src);
    return { ...item, src };
  }
  try {
    const groups = [album.tracks, album.photos, editor ? [] : (album.legacyVideos ?? [])];
    const results = await Promise.allSettled(groups.flat().map(resolve));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
    const items = results.map(result => result.value);
    const end = groups[0].length + groups[1].length;
    return { ...album, tracks: items.slice(0, groups[0].length), photos: items.slice(groups[0].length, end),
      legacyVideos: editor ? album.legacyVideos : items.slice(end) };
  } catch (error) {
    created.forEach(src => URL.revokeObjectURL(src));
    throw error;
  }
}
if (query.has("album")) {
  document.body.classList.add("viewer");
  get("header").hidden = true;
  const file = { id: query.get("album"), resourceKey: query.get("rk") };
  const keyForm = get("viewer-key");
  async function openViewer() {
    status("앨범을 불러오는 중입니다.");
    try {
      const album = await withSources(await drive.loadAlbum(file));
      updatePlayer(album);
      for (const item of album.legacyVideos) {
        const video = document.createElement("video");
        video.className = "legacy-video"; video.controls = true; video.preload = "metadata";
        video.src = item.src;
        video.setAttribute("aria-label", item.name || "기존 앨범 영상");
        get("player").append(video);
      }
      preview.hidden = false;
      keyForm.hidden = true;
      get("key").value = "";
      document.title = album.title + " · 나만의 음악 앨범";
      status("");
    } catch (error) {
      preview.hidden = true;
      keyForm.hidden = false;
      status(error.message);
    }
  }
  preview.hidden = true;
  keyForm.hidden = drive.hasPublicKey();
  keyForm.onsubmit = async event => {
    event.preventDefault();
    if (!get("key").value.trim()) return;
    const button = keyForm.querySelector("button");
    button.disabled = true;
    drive.setPublicKey(get("key").value);
    try { await openViewer(); } finally { button.disabled = false; }
  };
  if (drive.hasPublicKey()) void openViewer();
} else {
  setupEditor();
}

function setupEditor() {
  const form = get("editor");
  const saved = get("saved"), save = get("save"), login = get("login"), link = get("link");
  let album = blank(), identity = {}, known = new Map(), dirty = false, busy = false;
  form.hidden = false;

  function showLink() {
    link.value = identity.id ? drive.albumLink(identity) : "";
    get("link-row").hidden = !link.value;
  }
  function renderPreview() {
    updatePlayer(album);
    renderThemePicker();
  }
  function changed() { dirty = true; renderPreview(); }
  function release(item) { if (item.src?.startsWith("blob:")) URL.revokeObjectURL(item.src); }
  function reset(next, file = {}) {
    const old = album;
    album = next; identity = file; dirty = false;
    get("title").value = album.title;
    get("share").checked = false;
    renderFiles("tracks");
    renderFiles("photos");
    renderPreview();
    showLink();
    [...old.tracks, ...old.photos].forEach(release);
  }
  function renderFiles(kind) {
    const tracks = kind === "tracks";
    const list = get(tracks ? "track-list" : "photo-list");
    const items = album[kind];
    list.replaceChildren(...items.map((item, index) => {
      const row = document.createElement("li"), controls = document.createElement("div");
      controls.className = "file-controls";
      if (tracks) {
        const title = document.createElement("input");
        title.value = item.title ?? ""; title.maxLength = 120;
        title.setAttribute("aria-label", `${index + 1}번 곡 제목`);
        title.oninput = () => { item.title = title.value; changed(); };
        row.append(title);
      } else {
        const img = document.createElement("img"), name = document.createElement("span");
        img.className = "mini"; img.alt = ""; img.src = item.src;
        name.className = "filename"; name.textContent = item.file?.name ?? `사진 ${index + 1}`;
        row.append(img, name);
      }
      for (const [text, label, delta] of [["↑", "위로", -1], ["↓", "아래로", 1], ["삭제", "삭제", 0]]) {
        const button = document.createElement("button");
        button.type = "button"; button.textContent = text;
        button.setAttribute("aria-label", `${index + 1}번 ${tracks ? "곡" : "사진"} ${label}`);
        button.disabled = delta !== 0 && (index + delta < 0 || index + delta >= items.length);
        button.onclick = () => {
          const [selected] = items.splice(index, 1);
          if (delta) items.splice(index + delta, 0, selected);
          renderFiles(kind);
          changed();
          if (!delta) release(selected);
        };
        controls.append(button);
      }
      row.append(controls);
      return row;
    }));
  }
  for (const [kind, prefix] of [["tracks", "audio"], ["photos", "image"]]) {
    const input = get(kind);
    input.onchange = () => {
      const limit = 1024 * 1024;
      let total = [...album.tracks, ...album.photos].reduce((sum, item) => sum + (item.file?.size ?? 0), 0);
      const accepted = [...input.files].filter(file => {
        const supported = file.type.startsWith(prefix + "/") ||
          (kind === "tracks" && /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(file.name));
        if (!supported || !file.size || file.size > 20 * limit || total + file.size > 50 * limit) return false;
        total += file.size;
        return true;
      });
      album[kind].push(...accepted.map(file => ({
        file, title: file.name.replace(/\.[^.]+$/, "").slice(0, 120), src: URL.createObjectURL(file),
      })));
      status(accepted.length < input.files.length ? "지원 형식 또는 용량 기준에 맞지 않는 파일을 건너뛰었습니다." : "");
      input.value = "";
      renderFiles(kind);
      changed();
    };
  }
  const category = get("theme-category"), slide = get("theme-slide"), image = get("theme-image");
  const previousTheme = get("theme-prev"), nextTheme = get("theme-next");
  const currentThemeOption = new Option("현재 테마", "");
  currentThemeOption.disabled = true;
  category.append(currentThemeOption);
  for (const [id, { name }] of categories) category.append(new Option(name, id));
  category.disabled = !categories.size;
  get("theme-error").hidden = !!categories.size;

  function renderThemePicker() {
    const theme = themes.get(album.theme) ?? themes.get("dark");
    const ids = categories.get(theme.categoryId)?.ids ?? [];
    const index = ids.indexOf(album.theme);
    currentThemeOption.textContent = `현재 테마 · ${theme.label}`;
    currentThemeOption.hidden = index >= 0;
    category.value = theme.categoryId ?? "";
    applyTheme(get("theme-art"), album.theme);
    image.hidden = !theme.image;
    if (theme.image) {
      if (image.src !== theme.image) image.src = theme.image;
    } else image.removeAttribute("src");
    get("theme-caption").textContent = index >= 0 ? `${theme.label} · ${index + 1} / ${ids.length}` : theme.label;
    previousTheme.disabled = nextTheme.disabled = ids.length < 2;
  }
  function selectTheme(id) {
    if (!id || id === album.theme) return;
    album.theme = id;
    dirty = true;
    applyTheme(get("player"), id);
    renderThemePicker();
  }
  function moveTheme(step) {
    const ids = categories.get(category.value)?.ids ?? [];
    if (ids.length < 2) return;
    const index = ids.indexOf(album.theme);
    selectTheme(ids[(index + step + ids.length) % ids.length]);
  }
  category.onchange = () => selectTheme(categories.get(category.value)?.ids[0]);
  previousTheme.onclick = () => moveTheme(-1);
  nextTheme.onclick = () => moveTheme(1);
  let start;
  slide.onpointerdown = event => {
    if (event.pointerType !== "touch" || !event.isPrimary || nextTheme.disabled) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    slide.setPointerCapture(event.pointerId);
  };
  slide.onpointercancel = event => { if (start?.id === event.pointerId) start = undefined; };
  slide.onpointerup = event => {
    if (start?.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    start = undefined;
    if (Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.3) moveTheme(dx < 0 ? 1 : -1);
  };
  get("title").oninput = event => { album.title = event.target.value; changed(); };
  function controls(locked) {
    busy = locked;
    form.inert = locked;
    login.disabled = locked || !drive.configured;
    save.disabled = locked || !drive.connected();
    saved.disabled = locked || !drive.connected() || !known.size;
    get("open").disabled = saved.disabled || !saved.value;
  }
  async function refresh() {
    const files = await drive.listAlbums();
    known = new Map(files.map(file => [file.id, file]));
    const placeholder = new Option("저장한 앨범 선택", "");
    saved.replaceChildren(placeholder, ...files.map(file => new Option(file.name.replace(/\.album\.json$/, ""), file.id)));
    saved.value = known.has(identity.id) ? identity.id : "";
  }
  function canDiscard() { return !dirty || confirm("저장하지 않은 변경 내용을 버릴까요?"); }
  saved.onchange = () => controls(busy);
  get("new").onclick = () => { if (canDiscard()) { reset(blank()); saved.value = ""; controls(false); status(""); } };
  get("open").onclick = async () => {
    if (busy || !canDiscard()) return;
    const file = known.get(saved.value);
    if (!file) return;
    controls(true);
    try {
      reset(await withSources(await drive.loadAlbum(file, true), true), { ...file, folderId: file.parents?.[0] });
      status("앨범을 열었습니다.");
    }
    catch (error) { status(error.message); }
    finally { controls(false); }
  };
  login.onclick = async () => {
    controls(true);
    try {
      const email = await drive.connect();
      login.textContent = "Google 계정 다시 연결";
      await refresh();
      status(email ? email + " 연결됨" : "Google 계정 연결됨");
    } catch (error) { status(error.message); }
    finally { controls(false); }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    if (!drive.connected()) { controls(false); status("Google 계정을 다시 연결하세요."); return; }
    const hasMedia = identity.id
      ? album.tracks.length || album.photos.length || album.legacyVideos?.length
      : album.tracks.length && album.photos.length;
    if (!album.title.trim() || !hasMedia) {
      status(identity.id ? "앨범 제목과 미디어를 추가하세요." : "앨범 제목과 음악 및 사진을 각각 추가하세요.");
      return;
    }
    if (!get("share").checked) { status("저장하기 전에 이 앨범 파일의 링크 공유를 확인하세요."); return; }
    controls(true);
    try {
      await drive.saveAlbum({ ...album, title: album.title.trim() }, identity, status);
      dirty = false;
      showLink();
      status("Google Drive에 저장했습니다.");
      try { await refresh(); }
      catch { status("앨범을 저장했습니다. 앨범 목록은 다시 연결하면 갱신됩니다."); }
    } catch (error) { status(error.message); }
    finally { controls(false); }
  };
  get("copy").onclick = async () => {
    try { await navigator.clipboard.writeText(link.value); status("감상 링크를 복사했습니다."); }
    catch { link.select(); status("선택한 감상 링크를 복사하세요."); }
  };
  window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  renderPreview();
  controls(false);
  if (!drive.configured) get("login").textContent = "Google 연결 설정 필요";
  get("viewer-key").hidden = true;
}
