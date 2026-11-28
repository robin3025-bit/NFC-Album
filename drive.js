import { clientId, browserKey } from "./config.js";

const api = "https://www.googleapis.com/drive/v3";
const upload = "https://www.googleapis.com/upload/drive/v3";
const scope = "https://www.googleapis.com/auth/drive.file";
const marker = { studio: "personal-music-album-v02" };
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
let session, account, publicKey = browserKey;

export const configured = Boolean(clientId);
export const hasPublicKey = () => Boolean(publicKey);
export function setPublicKey(key) { publicKey = key.trim(); }
export const connected = () => !!session && Date.now() < session.expires;
export function mediaUrl(file, authenticated = false) {
  if (!validId(file.id)) throw new Error("Drive 파일 ID가 올바르지 않습니다.");
  const url = new URL(`${api}/files/${file.id}`);
  url.searchParams.set("alt", "media");
  if (!authenticated) {
    url.searchParams.set("key", publicKey);
    if (validId(file.resourceKey)) url.searchParams.set("resourceKey", file.resourceKey);
  }
  return url;
}
async function request(url, options = {}, authenticated = true) {
  const headers = new Headers(options.headers);
  if (authenticated) {
    if (!connected()) throw new Error("Google 계정을 다시 연결한 뒤 시도하세요.");
    headers.set("Authorization", "Bearer " + session.token);
  }
  const response = await fetch(url, { ...options, headers });
  if (response.ok) return response;
  if (response.status === 401 && authenticated) {
    session = undefined;
    throw new Error("Google 연결이 만료되었습니다. 계정을 다시 연결하세요.");
  }
  if (response.status === 403) throw new Error("Drive 접근이 거부되었습니다. 계정 및 파일 공유 권한을 확인하세요.");
  if (response.status === 404) throw new Error("Drive 파일을 찾을 수 없습니다. 링크와 공유 상태를 확인하세요.");
  throw new Error(`Drive 요청에 실패했습니다 (${response.status}). 잠시 후 다시 시도하세요.`);
}
export async function connect() {
  if (!configured) throw new Error("Google 연결 설정이 비어 있습니다. 로컬 미리보기를 사용할 수 있습니다.");
  const oauth = globalThis.google?.accounts?.oauth2;
  if (!oauth) throw new Error("Google 로그인 모듈을 불러오지 못했습니다. 잠시 후 다시 시도하세요.");
  const result = await new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Google 연결이 취소되었거나 승인되지 않았습니다."));
    const auth = oauth.initTokenClient({
      client_id: clientId, scope, include_granted_scopes: false,
      callback: response => response.error ? fail() : resolve(response), error_callback: fail,
      hint: account?.emailAddress,
    });
    auth.requestAccessToken({ prompt: account ? "" : "select_account" });
  });
  if (!oauth.hasGrantedAllScopes(result, scope)) throw new Error("앨범 파일 저장 권한이 필요합니다.");
  session = { token: result.access_token, expires: Date.now() + Math.max(0, Number(result.expires_in) - 30) * 1000 };
  try {
    const { user } = await (await request(api + "/about?fields=user(emailAddress,permissionId)")).json();
    if (!user?.permissionId || (account && user.permissionId !== account.permissionId)) {
      throw new Error("기존 작업과 계정을 분리하려면 새 탭에서 다른 계정으로 연결하세요.");
    }
    account = user;
    return user.emailAddress;
  } catch (error) { session = undefined; throw error; }
}
export async function listAlbums() {
  const files = [];
  let pageToken;
  do {
    const url = new URL(api + "/files");
    url.search = new URLSearchParams({
      q: "trashed = false and 'me' in owners and (appProperties has { key='studio' and value='personal-music-album-v02' } or (name = 'album.json' and mimeType = 'application/json'))",
      fields: "nextPageToken,files(id,name,resourceKey,parents)", orderBy: "modifiedTime desc", pageSize: "100",
      ...(pageToken ? { pageToken } : {}),
    });
    const result = await (await request(url)).json();
    files.push(...result.files);
    pageToken = result.nextPageToken;
  } while (pageToken);
  return files;
}
async function saveBlob(blob, metadata, id) {
  const boundary = "album-" + crypto.randomUUID();
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`, blob,
    `\r\n--${boundary}--\r\n`,
  ]);
  const path = id ? "/files/" + id : "/files";
  return (await request(upload + path + "?uploadType=multipart&fields=id,resourceKey", {
    method: id ? "PATCH" : "POST", body, headers: { "Content-Type": "multipart/related; boundary=" + boundary },
  })).json();
}
async function share(file) {
  const url = api + "/files/" + file.id + "/permissions";
  const { permissions } = await (await request(url + "?fields=permissions(type,role)")).json();
  if (!permissions.some(permission => permission.type === "anyone" && permission.role === "reader")) {
    await request(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "anyone", role: "reader", allowFileDiscovery: false }),
    });
  }
}
function normalize(data) {
  const validItem = item => item && validId(item.id) && (!item.resourceKey || validId(item.resourceKey));
  if (data?.version === 1 && Array.isArray(data.items)) {
    const items = data.items.filter(validItem);
    return {
      title: typeof data.title === "string" ? data.title : "앨범", theme: data.theme ?? "dark", legacyFormat: true,
      tracks: items.filter(item => item.type === "audio").map(item => ({ ...item, title: item.name })),
      photos: items.filter(item => item.type === "img"),
      legacyVideos: items.filter(item => item.type === "video"),
    };
  }
  if (data?.version !== 2 || typeof data.title !== "string" || !Array.isArray(data.tracks) ||
    !Array.isArray(data.photos) || !(data.legacyVideos === undefined || Array.isArray(data.legacyVideos)) ||
    ![...data.tracks, ...data.photos, ...(data.legacyVideos ?? [])].every(validItem)) {
    throw new Error("이 앨범의 형식을 읽을 수 없습니다.");
  }
  return data;
}
function mediaHeaders(file) {
  return validId(file.resourceKey) ? { "X-Goog-Drive-Resource-Keys": file.id + "/" + file.resourceKey } : {};
}
export async function loadAlbum(file, authenticated = false) {
  if (!authenticated && !hasPublicKey()) throw new Error("Drive API 키를 입력하세요.");
  const response = await request(mediaUrl(file, authenticated), { cache: "no-store", headers: mediaHeaders(file) }, authenticated);
  return normalize(await response.json());
}
export async function loadEditorMedia(file) {
  const response = await request(mediaUrl(file, true), { headers: mediaHeaders(file) });
  return URL.createObjectURL(await response.blob());
}
export async function saveAlbum(album, identity, progress) {
  if (!identity.folderId) {
    const folder = await request(api + "/files?fields=id", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NFC 앨범 · " + album.title, mimeType: "application/vnd.google-apps.folder" }),
    });
    identity.folderId = (await folder.json()).id;
  }
  for (const item of [...album.tracks, ...album.photos]) {
    if (!item.file) continue;
    if (!item.id) {
      progress(item.file.name + " 업로드 중");
      Object.assign(item, await saveBlob(item.file, { name: item.file.name, parents: [identity.folderId] }));
    }
    if (!item.shared) {
      await share(item);
      item.shared = true;
    }
  }
  const ref = ({ id, resourceKey }) => ({ id, ...(resourceKey ? { resourceKey } : {}) });
  const data = album.legacyFormat ? {
    version: 1, title: album.title, theme: album.theme,
    items: [
      ...album.tracks.map(item => ({ ...ref(item), name: item.title, type: "audio" })),
      ...album.photos.map(item => ({ ...ref(item), name: item.name || item.file?.name || "앨범 사진", type: "img" })),
      ...(album.legacyVideos ?? []).map(item => ({ ...ref(item), name: item.name, type: "video" })),
    ],
  } : { version: 2, title: album.title, theme: album.theme,
    tracks: album.tracks.map(item => ({ ...ref(item), title: item.title })),
    photos: album.photos.map(ref),
    ...(album.legacyVideos?.length ? { legacyVideos: album.legacyVideos.map(item => ({ ...ref(item), name: item.name })) } : {}),
  };
  progress("앨범 정보 저장 중");
  const name = album.title + ".album.json";
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const metadata = { name, appProperties: marker };
  if (!identity.id) metadata.parents = [identity.folderId];
  if (identity.id) await share(identity);
  Object.assign(identity, await saveBlob(blob, metadata, identity.id));
  if (metadata.parents) await share(identity);
  return identity;
}
export function albumLink({ id, resourceKey }) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("album", id);
  if (resourceKey) url.searchParams.set("rk", resourceKey);
  return url.href;
}
