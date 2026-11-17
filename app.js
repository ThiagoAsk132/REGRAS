// Regras ACAVES — app web (PWA) que lê e grava o REGRAS DE PROJETO.md no Google Drive.
// Acesso ao Drive: escopo drive.file (o app só enxerga os arquivos que ele mesmo criou).
// Alterações viram "operações" numa fila local: se faltar internet ou o login vencer,
// ficam guardadas e são aplicadas depois sobre a versão mais nova do arquivo.
(() => {
"use strict";

const CFG = window.REGRAS_CONFIG || {};
const DEMO = new URLSearchParams(location.search).has("demo");
const ESCOPO = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const CAIXA = "CAIXA DE ENTRADA — regras novas (a classificar)";
const P = DEMO ? "regrasDemo_" : "regras_";        // prefixo das chaves do localStorage

// ---------- armazenamento local (nunca pode derrubar o app) ----------
const loc = {
  ler(k, padrao) { try { const v = localStorage.getItem(P + k); return v === null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch { } },
  apagar(k) { try { localStorage.removeItem(P + k); } catch { } }
};

const $ = id => document.getElementById(id);
let texto = loc.ler("texto", null);        // última versão baixada do Drive
let fila = loc.ler("fila", []);            // operações ainda não gravadas no Drive
let ultimaSinc = loc.ler("sinc", null);
let editando = null;                       // seção aberta no editor

// ---------- utilidades ----------
function toast(msg, ms = 3200) {
  const t = $("toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = "none", ms);
}
function hoje() {
  const d = new Date();
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function mostrarTela(id) {
  document.querySelectorAll(".tela").forEach(t => t.classList.toggle("ativa", t.id === id));
  $("btNova").style.display = id === "telaRegras" ? "" : "none";
}
function estado() {
  let s = DEMO ? "modo demonstração" : (navigator.onLine ? "" : "sem internet");
  if (fila.length) s += (s ? " · " : "") + fila.length + " alteração(ões) a enviar";
  else if (ultimaSinc) s += (s ? " · " : "") + "Drive " + ultimaSinc;
  $("estado").textContent = s;
}

// ---------- Markdown: seções e operações ----------
// Seção = do "## Título" até o próximo "## ". O que vem antes do primeiro "## " é o cabeçalho.
function secoes(md) {
  const linhas = md.split("\n"), out = [];
  let atual = { titulo: null, ini: 0, linhas: [] };
  linhas.forEach((l, i) => {
    if (/^## /.test(l)) { out.push(atual); atual = { titulo: l.slice(3).trim(), cab: l, ini: i, linhas: [] }; }
    else atual.linhas.push(l);
  });
  out.push(atual);
  return out;
}
function juntar(lista) {
  return lista.map(s => (s.titulo === null ? "" : (s.cab || "## " + s.titulo) + "\n") + s.linhas.join("\n")).join("\n")
    .replace(/^\n/, "");
}
function corpo(sec) { return sec.linhas.join("\n"); }

// Remove do fim da seção as linhas vazias e o separador "---"; devolve o rabo para recolocar depois.
function separarRabo(linhas) {
  let k = linhas.length;
  while (k > 0 && (/^\s*$/.test(linhas[k - 1]) || /^---\s*$/.test(linhas[k - 1]))) k--;
  return [linhas.slice(0, k), linhas.slice(k)];
}

function aplicar(md, op) {
  const lista = secoes(md);
  if (op.tipo === "add") {
    let sec = lista.find(s => s.titulo === op.secao);
    if (!sec && op.secao === CAIXA) {            // cria a caixa de entrada antes do primeiro assunto
      sec = { titulo: CAIXA, linhas: ["", "Regras escritas pelo celular. O Claude classifica cada uma no assunto certo e propaga para a skill/agente.", "", "---", ""] };
      lista.splice(Math.min(1, lista.length), 0, sec);
    }
    if (!sec) throw new Error('O assunto "' + op.secao + '" não existe mais no arquivo. A regra ficou na Caixa de entrada.');
    const [miolo, rabo] = separarRabo(sec.linhas);
    if (miolo.length && !/^\s*$/.test(miolo[miolo.length - 1]) && !/^\s*([-*]|\d+\.)\s/.test(miolo[miolo.length - 1])) miolo.push("");
    const regra = op.texto.trim().replace(/\s*\n\s*/g, " ");
    // continua a numeração se o assunto for lista numerada (1. 2. 3.), senão usa "- "
    let ultimoNum = null;
    for (let k = miolo.length - 1; k >= 0; k--) { const mm = miolo[k].match(/^(\d+)\.\s/); if (mm) { ultimoNum = Number(mm[1]); break; } if (/^[-*]\s/.test(miolo[k])) break; }
    miolo.push((ultimoNum !== null ? (ultimoNum + 1) + ". " : "- ") + regra + " [celular " + op.data + "]");
    sec.linhas = miolo.concat(rabo.length ? rabo : [""]);
    return juntar(lista);
  }
  if (op.tipo === "editar") {
    const sec = lista.find(s => s.titulo === op.secao);
    if (!sec) throw new Error('O assunto "' + op.secao + '" foi renomeado ou apagado no computador.');
    if (corpo(sec) !== op.antes) throw new Error('O assunto "' + op.secao + '" mudou no computador enquanto você editava.');
    sec.linhas = op.depois.split("\n");
    return juntar(lista);
  }
  throw new Error("operação desconhecida");
}

// Texto mostrado na tela = Drive + operações pendentes (as que conflitarem ficam de fora).
function textoVisivel() {
  let md = texto || "";
  for (const op of fila) { try { md = aplicar(md, op); } catch { } }
  return md;
}

// ---------- Markdown: desenho na tela ----------
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}
function renderizar(md) {
  const linhas = md.split("\n"); let html = "", i = 0;
  const pilha = [];                                  // listas abertas: {ind, tag}
  const fecharListas = (ate = -1) => { while (pilha.length && pilha[pilha.length - 1].ind > ate) html += "</li></" + pilha.pop().tag + ">"; };
  let par = [];
  const fecharPar = () => { if (par.length) { html += "<p>" + inline(par.join(" ")) + "</p>"; par = []; } };
  while (i < linhas.length) {
    const l = linhas[i];
    const m = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (/^\s*\|/.test(l)) {                          // tabela
      fecharPar(); fecharListas();
      let t = "<div class='tabela'><table>";
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) {
        const cel = linhas[i].trim().replace(/^\||\|$/g, "").split("|");
        if (!cel.every(c => /^\s*:?-+:?\s*$/.test(c))) t += "<tr>" + cel.map(c => "<td>" + inline(c.trim()) + "</td>").join("") + "</tr>";
        i++;
      }
      html += t + "</table></div>"; continue;
    }
    if (m) {
      fecharPar();
      const ind = m[1].replace(/\t/g, "  ").length, tag = /\d/.test(m[2]) ? "ol" : "ul";
      const topo = pilha[pilha.length - 1];
      if (!topo || ind > topo.ind) { html += "<" + tag + "><li>"; pilha.push({ ind, tag }); }
      else { fecharListas(ind); html += "</li><li>"; }
      html += inline(m[3]);
    } else if (/^#{3,6}\s/.test(l)) { fecharPar(); fecharListas(); html += "<h4>" + inline(l.replace(/^#+\s*/, "")) + "</h4>"; }
    else if (/^---\s*$/.test(l)) { fecharPar(); fecharListas(); }
    else if (/^\s*$/.test(l)) { fecharPar(); }
    else if (pilha.length && /^\s+\S/.test(l)) { html += " " + inline(l.trim()); }   // continuação do item
    else { fecharListas(); par.push(l.trim()); }
    i++;
  }
  fecharPar(); fecharListas();
  return html;
}

function desenhar() {
  const md = textoVisivel(), lista = secoes(md), q = $("busca").value.trim().toLowerCase();
  const abertos = new Set([...document.querySelectorAll("details.secao[open]")].map(d => d.dataset.t));
  const el = $("lista"); el.innerHTML = "";
  if (q) {                                          // busca: mostra só as linhas que batem
    let n = 0;
    lista.forEach(s => s.linhas.forEach(l => {
      if (l.toLowerCase().includes(q) && l.trim()) {
        n++;
        const d = document.createElement("div"); d.className = "achado";
        const marcado = inline(l.replace(/^\s*[-*]\s+/, "")).replace(new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"), "<mark>$1</mark>");
        d.innerHTML = marcado + "<small>" + esc(s.titulo || "Cabeçalho") + "</small>";
        el.appendChild(d);
      }
    }));
    if (!n) el.innerHTML = "<p class='aviso-texto'>Nada encontrado.</p>";
    return;
  }
  lista.forEach(s => {
    if (s.titulo === null) return;                  // cabeçalho do arquivo não aparece
    const d = document.createElement("details"); d.className = "secao"; d.dataset.t = s.titulo;
    if (abertos.has(s.titulo)) d.open = true;
    const nRegras = s.linhas.filter(l => /^([-*]|\d+\.)\s/.test(l)).length;
    d.innerHTML = "<summary><span>" + inline(s.titulo) + "</span><span class='n'>" + nRegras + "</span></summary>" +
      "<div class='corpo'>" + renderizar(corpo(s)) +
      "<div class='acoes-secao'><button class='botao sec' data-add>+ Regra aqui</button><button class='botao sec' data-edit>Editar texto</button></div></div>";
    d.querySelector("[data-add]").onclick = () => abrirNova(s.titulo);
    d.querySelector("[data-edit]").onclick = () => abrirEditar(s.titulo);
    el.appendChild(d);
  });
  estado();
}

// ---------- login Google (fluxo por redirecionamento: funciona no app da tela de início do iPhone) ----------
function redirectUri() { return location.origin + location.pathname.replace(/index\.html$/, ""); }
function token() {
  const t = loc.ler("token", null);
  return t && t.exp > Date.now() + 60000 ? t.v : null;
}
function entrar() {
  if (!CFG.CLIENT_ID) { $("semConfig").style.display = ""; return; }
  const st = Math.random().toString(36).slice(2);
  loc.gravar("estadoOauth", st);
  const p = new URLSearchParams({
    client_id: CFG.CLIENT_ID, redirect_uri: redirectUri(), response_type: "token",
    scope: ESCOPO, include_granted_scopes: "true", state: st
  });
  const conta = loc.ler("conta", null);
  if (conta) p.set("login_hint", conta);
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

// ---------- Google Drive ----------
const drive = {
  async achar() {
    if (DEMO) return loc.ler("demoArquivo", null) !== null ? "demo" : null;
    const id = loc.ler("idArquivo", null);
    if (id) {
      try { const r = await api(API + "/files/" + id + "?fields=id,trashed"); const j = await r.json(); if (!j.trashed) return id; }
      catch (e) { if (e instanceof SemLogin) throw e; }
    }
    const q = encodeURIComponent("name = '" + CFG.NOME_ARQUIVO.replace(/'/g, "\\'") + "' and trashed = false");
    const r = await api(API + "/files?q=" + q + "&orderBy=modifiedTime desc&fields=files(id)&spaces=drive");
    const j = await r.json();
    const achado = j.files && j.files[0] ? j.files[0].id : null;
    if (achado) loc.gravar("idArquivo", achado);
    return achado;
  },
  async baixar(id) {
    const bruto = DEMO ? loc.ler("demoArquivo", "") : await (await api(API + "/files/" + id + "?alt=media")).text();
    loc.gravar("crlf", bruto.includes("\r\n"));          // devolve no mesmo fim de linha (Windows ou não)
    return bruto.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  },
  async subir(id, md) {
    if (loc.ler("crlf", false)) md = md.replace(/\n/g, "\r\n");
    if (DEMO) { loc.gravar("demoArquivo", md); return; }
    await api(UPLOAD + "/files/" + id + "?uploadType=media", {
      method: "PATCH", headers: { "Content-Type": "text/markdown; charset=UTF-8" }, body: md
    });
  },
  async criar(md) {
    if (DEMO) { loc.gravar("demoArquivo", md); return "demo"; }
    const rp = await api(API + "/files?fields=id", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: CFG.NOME_PASTA, mimeType: "application/vnd.google-apps.folder" })
    });
    const pasta = (await rp.json()).id;
    const limite = "regras" + Date.now();
    const meta = JSON.stringify({ name: CFG.NOME_ARQUIVO, parents: [pasta], mimeType: "text/markdown" });
    const corpoMp = "--" + limite + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
      "\r\n--" + limite + "\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n" + md + "\r\n--" + limite + "--";
    const r = await api(UPLOAD + "/files?uploadType=multipart&fields=id", {
      method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + limite }, body: corpoMp
    });
    const id = (await r.json()).id;
    loc.gravar("idArquivo", id);
    return id;
  }
};

// ---------- sincronização ----------
let sincronizando = false;
async function sincronizar(silencioso) {
  if (sincronizando) return;
  if (!DEMO && !navigator.onLine) { estado(); if (!silencioso) toast("Sem internet: as alterações ficam guardadas no celular."); return; }
  sincronizando = true;
  try {
    const id = await drive.achar();
    if (!id) { mostrarTela("telaImportar"); return; }
    let md = await drive.baixar(id);
    if (fila.length) {
      const problemas = [];
      for (const op of fila) {
        try { md = aplicar(md, op); }
        catch (e) {
          problemas.push(e.message);
          // não perde o que foi escrito: vai para a caixa de entrada
          const resgate = op.tipo === "add" ? op.texto : "(edição não aplicada de \"" + op.secao + "\") " + op.depois;
          md = aplicar(md, { tipo: "add", secao: CAIXA, texto: resgate, data: op.data || hoje() });
        }
      }
      await drive.subir(id, md);
      fila = []; loc.gravar("fila", fila);
      if (problemas.length) alert("Algumas alterações bateram com mudanças feitas no computador e foram para a Caixa de entrada:\n\n" + problemas.join("\n"));
      else if (!silencioso) toast("Salvo no Drive.");
    } else if (!silencioso) toast("Atualizado.");
    texto = md; loc.gravar("texto", texto);
    const d = new Date(); ultimaSinc = hoje().slice(0, 5) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    loc.gravar("sinc", ultimaSinc);
    mostrarTela("telaRegras"); desenhar();
  } catch (e) {
    if (e instanceof SemLogin) {
      if (texto !== null) { mostrarTela("telaRegras"); desenhar(); faixa("Login do Google vencido. <a href='#' id='lkEntrar'>Entrar de novo</a> para enviar as alterações."); const a = $("lkEntrar"); if (a) a.onclick = ev => { ev.preventDefault(); entrar(); }; }
      else mostrarTela("telaEntrar");
    } else { toast(e.message, 6000); if (texto !== null) { mostrarTela("telaRegras"); desenhar(); } }
  } finally { sincronizando = false; estado(); }
}
function faixa(html) { const f = $("faixa"); f.innerHTML = html || ""; f.classList.toggle("visivel", !!html); }

function registrar(op) {
  fila.push(op); loc.gravar("fila", fila);
  desenhar();
  sincronizar(false);
}

// ---------- janelas ----------
function abrirModal(id) { $(id).classList.add("aberto"); }
function fecharModais() { document.querySelectorAll(".modal").forEach(m => m.classList.remove("aberto")); }
document.querySelectorAll("[data-fechar]").forEach(b => b.onclick = fecharModais);
document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) fecharModais(); }));

function abrirNova(secao) {
  const sel = $("selSecao"); sel.innerHTML = "";
  const titulos = secoes(textoVisivel()).map(s => s.titulo).filter(t => t !== null);
  if (!titulos.includes(CAIXA)) titulos.unshift(CAIXA);
  titulos.forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o); });
  sel.value = secao || loc.ler("ultimaSecao", CAIXA);
  if (!sel.value) sel.value = CAIXA;
  $("txtRegra").value = loc.ler("rascunho", "");
  abrirModal("modalNova");
  setTimeout(() => $("txtRegra").focus(), 50);
}
$("txtRegra").addEventListener("input", () => loc.gravar("rascunho", $("txtRegra").value));
$("btSalvarNova").onclick = () => {
  const t = $("txtRegra").value.trim();
  if (!t) { toast("Escreva a regra."); return; }
  const secao = $("selSecao").value;
  loc.gravar("ultimaSecao", secao); loc.apagar("rascunho");
  fecharModais();
  registrar({ tipo: "add", secao, texto: t, data: hoje() });
};

function abrirEditar(secao) {
  const s = secoes(textoVisivel()).find(x => x.titulo === secao);
  if (!s) return;
  editando = { secao, antes: corpo(s) };
  $("tituloEditar").textContent = secao;
  $("txtEditar").value = editando.antes;
  abrirModal("modalEditar");
}
$("btSalvarEditar").onclick = () => {
  const depois = $("txtEditar").value.replace(/\r\n/g, "\n");
  fecharModais();
  if (!editando || depois === editando.antes) return;
  registrar({ tipo: "editar", secao: editando.secao, antes: editando.antes, depois, data: hoje() });
  editando = null;
};

// ---------- importar (primeira vez) ----------
$("arquivoImportar").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const md = (await f.text()).replace(/^﻿/, "");   // sobe como está (fim de linha original)
  if (!/^## /m.test(md)) { toast("Esse arquivo não parece o REGRAS DE PROJETO.md (não tem títulos ##)."); return; }
  try { await drive.criar(md); toast("Arquivo criado no Drive."); sincronizar(true); }
  catch (er) { if (er instanceof SemLogin) entrar(); else toast(er.message, 6000); }
};

// ---------- início ----------
$("btEntrar").onclick = entrar;
$("btAtualizar").onclick = () => sincronizar(false);
$("btNova").onclick = () => abrirNova(null);
$("busca").addEventListener("input", desenhar);
$("nomePasta").textContent = CFG.NOME_PASTA || "";
window.addEventListener("online", () => sincronizar(true));
window.addEventListener("offline", estado);
document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizar(true); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });

if (DEMO) {
  if (!loc.ler("demoArquivo", null)) loc.gravar("demoArquivo",
    "# REGRAS (demonstração)\n\nArquivo de exemplo, só neste navegador.\n\n## 1. Geral\n\n- G1. Exemplo de regra geral.\n\n---\n\n## 2. Chapa metálica\n\n- C1. Espessuras habituais 1,50 · 2,00 · 2,65 · 3,00 mm.\n  - sub-item de exemplo\n\n| Calibre | mm |\n|---|---|\n| 14 | 2,00 |\n");
  loc.gravar("token", { v: "demo", exp: Date.now() + 864e5 });
}
lerRetornoLogin();
if (texto !== null) { mostrarTela("telaRegras"); desenhar(); }
else mostrarTela(token() ? "telaRegras" : "telaEntrar");
if (!CFG.CLIENT_ID && !DEMO) $("semConfig").style.display = "";
if (token() || DEMO) sincronizar(true);
estado();
})();
