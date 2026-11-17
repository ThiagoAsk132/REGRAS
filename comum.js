// ACAVES app — partes comuns: armazenamento local, login Google e acesso ao Google Drive.
// Escopo drive.file: o app só enxerga os arquivos que ele mesmo criou.
// Modo demonstração (?demo=1): um "Drive de mentira" guardado no localStorage deste navegador.
(() => {
"use strict";
const CFG = window.REGRAS_CONFIG || {};
const DEMO = new URLSearchParams(location.search).has("demo");
const ESCOPO = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const P = DEMO ? "acvDemo_" : "acv_";

const loc = {
  ler(k, padrao) { try { const v = localStorage.getItem(P + k); return v === null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch { return false; } },
  apagar(k) { try { localStorage.removeItem(P + k); } catch { } }
};

const $ = id => document.getElementById(id);
function toast(msg, ms = 3200) {
  const t = $("toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = "none", ms);
}
function hoje() {
  const d = new Date();
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}
function agoraCurto() {
  const d = new Date();
  return hoje().slice(0, 5) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// ---------- login (redirecionamento: funciona no app da tela de início do iPhone) ----------
function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ""); }
function token() {
  if (DEMO) return "demo";
  const t = loc.ler("token", null);
  return t && t.exp > Date.now() + 60000 ? t.v : null;
}
function entrar() {
  if (!CFG.CLIENT_ID) { toast("Falta o ID do cliente do Google em config.js."); return; }
  const st = Math.random().toString(36).slice(2);
  loc.gravar("estadoOauth", st);
  const p = new URLSearchParams({
    client_id: CFG.CLIENT_ID, redirect_uri: redirectUri(), response_type: "token",
    scope: ESCOPO, include_granted_scopes: "true", state: st
  });
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + p;
}
function lerRetornoLogin() {
  if (!location.hash.includes("access_token") && !location.hash.includes("error")) return;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname + location.search);
  if (h.get("error")) { toast("Login cancelado: " + h.get("error")); return; }
  if (h.get("state") !== loc.ler("estadoOauth", "")) { toast("Login recusado (estado não confere). Tente de novo."); return; }
  loc.gravar("token", { v: h.get("access_token"), exp: Date.now() + Number(h.get("expires_in") || 3600) * 1000 });
}

class SemLogin extends Error { }
async function api(url, opc = {}) {
  const t = token();
  if (!t) throw new SemLogin();
  const r = await fetch(url, { ...opc, headers: { ...(opc.headers || {}), Authorization: "Bearer " + t } });
  if (r.status === 401) { loc.apagar("token"); throw new SemLogin(); }
  if (!r.ok) throw new Error("Google Drive respondeu " + r.status + ": " + (await r.text()).slice(0, 200));
  return r;
}

// ---------- Drive de demonstração ----------
const demoFs = {
  ler() { return loc.ler("fs", {}); },
  gravar(fs) { if (!loc.gravar("fs", fs)) throw new Error("Demonstração: o navegador não tem espaço para isso (foto/vídeo grande demais)."); },
  novoId() { return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
};
function blobParaDataUrl(b) { return new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = erro; r.readAsDataURL(b); }); }

// ---------- Google Drive ----------
function multipart(meta, conteudo, tipo) {
  const lim = "acv" + Date.now();
  const corpo = new Blob([
    "--" + lim + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
    "\r\n--" + lim + "\r\nContent-Type: " + tipo + "\r\n\r\n",
    conteudo,
    "\r\n--" + lim + "--"
  ]);
  return { corpo, tipo: "multipart/related; boundary=" + lim };
}

const drive = {
  // procura um arquivo (que o app criou) pelo nome; guarda o id para a próxima vez
  async achar(nome, chave) {
    if (DEMO) { const fs = demoFs.ler(); return Object.keys(fs).find(id => fs[id].nome === nome && !fs[id].pasta) || null; }
    const id = loc.ler(chave, null);
    if (id) {
      try { const j = await (await api(API + "/files/" + id + "?fields=id,trashed")).json(); if (!j.trashed) return id; }
      catch (e) { if (e instanceof SemLogin) throw e; }
    }
    const q = encodeURIComponent("name = '" + nome.replace(/'/g, "\\'") + "' and trashed = false and mimeType != 'application/vnd.google-apps.folder'");
    const j = await (await api(API + "/files?q=" + q + "&orderBy=modifiedTime desc&fields=files(id)&spaces=drive")).json();
    const achado = j.files && j.files[0] ? j.files[0].id : null;
    if (achado) loc.gravar(chave, achado);
    return achado;
  },
  async texto(id) {
    if (DEMO) return demoFs.ler()[id].texto;
    return (await api(API + "/files/" + id + "?alt=media")).text();
  },
  async salvarTexto(id, texto, mime) {
    if (DEMO) { const fs = demoFs.ler(); fs[id].texto = texto; demoFs.gravar(fs); return; }
    await api(UPLOAD + "/files/" + id + "?uploadType=media", { method: "PATCH", headers: { "Content-Type": mime + "; charset=UTF-8" }, body: texto });
  },
  async pasta(nome, pai) {
    if (DEMO) { const fs = demoFs.ler(), id = demoFs.novoId(); fs[id] = { nome, pasta: true, pai }; demoFs.gravar(fs); return id; }
    const meta = { name: nome, mimeType: "application/vnd.google-apps.folder" };
    if (pai) meta.parents = [pai];
    return (await (await api(API + "/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) })).json()).id;
  },
  async criar(nome, pai, conteudo, mime) {                 // conteudo: texto ou Blob
    if (DEMO) {
      const fs = demoFs.ler(), id = demoFs.novoId();
      fs[id] = typeof conteudo === "string" ? { nome, pai, texto: conteudo } : { nome, pai, dataUrl: await blobParaDataUrl(conteudo), mime };
      demoFs.gravar(fs); return id;
    }
    const m = multipart({ name: nome, parents: pai ? [pai] : undefined, mimeType: mime }, conteudo, typeof conteudo === "string" ? mime + "; charset=UTF-8" : mime);
    return (await (await api(UPLOAD + "/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": m.tipo }, body: m.corpo })).json()).id;
  },
  async blob(id) {
    if (DEMO) { const f = demoFs.ler()[id]; return f ? (await fetch(f.dataUrl)).blob() : null; }
    return (await api(API + "/files/" + id + "?alt=media")).blob();
  }
};

window.ACV = { CFG, DEMO, loc, $, toast, hoje, agoraCurto, esc, token, entrar, lerRetornoLogin, SemLogin, drive };
})();
