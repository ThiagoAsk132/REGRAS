// Aba PENDÊNCIAS DE PROJETO — lista guardada em PENDENCIAS DE PROJETO.json no Google Drive,
// fotos e vídeos na subpasta FOTOS. Alterações viram operações (incluir / alterar campos / excluir)
// numa fila local e são aplicadas sobre a versão mais nova do arquivo: edições em campos diferentes
// feitas no celular e no computador não se apagam.
(() => {
"use strict";
const { loc, $, toast, agoraCurto, SemLogin, drive } = ACV;
const NOME = "PENDENCIAS DE PROJETO.json";
const PASTA = "ACAVES - PENDENCIAS";
const STATUS = [
  { k: "pendente", t: "Pendente", c: "var(--st-pend)" },
  { k: "alterado", t: "Alterado no SolidWorks", c: "var(--st-alt)" },
  { k: "conferido", t: "Conferido no protótipo", c: "var(--st-conf)" },
  { k: "gabaritado", t: "Gabaritado", c: "var(--st-gab)" }
];
const PRI = { alta: "Alta", media: "Média", baixa: "Baixa" };
const PRI_ORD = { alta: 0, media: 1, baixa: 2 };
const ORIGENS = ["Protótipo", "Montagem", "Solda", "Corte/Dobra", "Cliente", "Projeto"];

let dados = loc.ler("pendDados", null);          // { formato, pasta, pastaFotos, itens: [] }
let fila = loc.ler("pendFila", []);
let sinc = loc.ler("pendSinc", null);
let filtroStatus = "abertas", filtroProj = "", busca = "", rascunhos = {};
let sincronizando = false, situacao = "carregando";
const midias = {};                                // fotoId -> objectURL

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) { if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
function fmtData(iso) { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
function novoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

// ---------- operações ----------
function aplicar(d, op) {
  if (op.tipo === "meta") { Object.assign(d, op.patch); return null; }
  if (op.tipo === "add") { if (!d.itens.some(i => i.id === op.item.id)) d.itens.push(op.item); return null; }
  const i = d.itens.find(x => x.id === op.id);
  if (!i) return op.tipo === "del" ? null : "Uma pendência que você alterou foi excluída no computador.";
  if (op.tipo === "upd") Object.assign(i, op.patch);
  if (op.tipo === "del") d.itens = d.itens.filter(x => x.id !== op.id);
  return null;
}
function itens() {
  if (!dados) return [];
  const d = JSON.parse(JSON.stringify(dados));
  for (const op of fila) aplicar(d, op);
  return d.itens;
}
function registrar(op) { fila.push(op); loc.gravar("pendFila", fila); desenhar(); sincronizar(false); }
function salvar(id, patch) { registrar({ tipo: "upd", id, patch: { ...patch, atualizado: new Date().toISOString() } }); }

async function sincronizar(silencioso) {
  if (sincronizando) return;
  if (!ACV.DEMO && !navigator.onLine) { if (!silencioso) toast("Sem internet: as alterações ficam guardadas no celular."); return; }
  sincronizando = true;
  try {
    const id = await drive.achar(NOME, "pendId");
    if (!id) { situacao = "importar"; desenhar(); return; }
    const d = JSON.parse(await drive.texto(id));
    if (!Array.isArray(d.itens)) throw new Error("O arquivo " + NOME + " no Drive está com formato inválido.");
    if (fila.length) {
      const avisos = fila.map(op => aplicar(d, op)).filter(Boolean);
      d.atualizado = new Date().toISOString();
      await drive.salvarTexto(id, JSON.stringify(d, null, 1), "application/json");
      fila = []; loc.gravar("pendFila", fila);
      if (avisos.length) alert(avisos.join("\n"));
      else if (!silencioso) toast("Salvo no Drive.");
    }
    dados = d; loc.gravar("pendDados", dados);
    sinc = agoraCurto(); loc.gravar("pendSinc", sinc);
    situacao = "pronto"; desenhar();
  } catch (e) {
    if (e instanceof SemLogin) { situacao = "login"; ACV.pedirLogin(); }
    else toast(e.message, 6000);
  } finally { sincronizando = false; ACV.atualizarEstado(); }
}

// ---------- fotos e vídeos ----------
function reduzirFoto(file) {                       // foto do celular (3–5 MB) -> JPEG de até 1600 px
  return new Promise(ok => {
    if (!file.type.startsWith("image/") || file.type === "image/gif") { ok(file); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => ok(b && b.size < file.size ? b : file), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); ok(file); };
    img.src = url;
  });
}
async function enviarMidia(file, projeto, peca) {
  if (!ACV.DEMO && !navigator.onLine) throw new Error("Foto e vídeo precisam de internet para enviar.");
  if (!dados) throw new Error("A lista ainda não carregou do Drive.");
  if (!dados.pastaFotos) {                         // cria a subpasta FOTOS se faltar
    dados.pastaFotos = await drive.pasta("FOTOS", dados.pasta);
    fila.push({ tipo: "meta", patch: { pastaFotos: dados.pastaFotos } }); loc.gravar("pendFila", fila);
  }
  const blob = await reduzirFoto(file);
  const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "bin").toLowerCase();
  const nome = (projeto + " - " + (peca || "item") + " - " + new Date().toISOString().slice(0, 10)).replace(/[\\/:*?"<>|]/g, "-") + "." + ext;
  return { fotoId: await drive.criar(nome, dados.pastaFotos, blob, blob.type || file.type), fotoTipo: blob.type || file.type };
}
async function urlMidia(id) {
  if (!midias[id]) midias[id] = drive.blob(id).then(b => b ? URL.createObjectURL(b) : null);
  return midias[id];
}
function blocoMidia(i) {
  const box = el("div", { class: "photo" });
  if ((i.fotoTipo || "").startsWith("video/")) {
    const b = el("button", { class: "btn", type: "button", text: "▶ Ver vídeo" });
    b.onclick = async () => {
      b.disabled = true; b.textContent = "Carregando vídeo…";
      try { const u = await urlMidia(i.fotoId); const v = el("video", { controls: "", playsinline: "" }); v.src = u; box.replaceChildren(v); }
      catch (e) { b.disabled = false; b.textContent = "▶ Ver vídeo"; toast(e instanceof SemLogin ? "Entre com o Google para ver o vídeo." : "Não consegui baixar o vídeo."); }
    };
    box.append(b);
  } else {
    const img = el("img", { alt: ("Foto da pendência " + (i.peca || "")).trim() });
    box.append(img);
    urlMidia(i.fotoId).then(u => { if (u) img.src = u; }).catch(() => { delete midias[i.fotoId]; box.replaceChildren(el("span", { class: "msg", text: "Foto indisponível agora (sem internet ou login vencido)." })); });
  }
  return box;
}

// ---------- tela ----------
function renderStats(lista) {
  const box = $("pendStats"); box.textContent = "";
  const defs = [{ k: "abertas", t: "Em aberto", n: lista.filter(i => i.status !== "gabaritado").length, c: "var(--accent)" },
    ...STATUS.map(s => ({ k: s.k, t: s.t, n: lista.filter(i => i.status === s.k).length, c: s.c }))];
  for (const d of defs) {
    const b = el("button", { class: "chip", type: "button", "aria-pressed": String(filtroStatus === d.k), title: d.t });
    const lab = el("span"), dot = el("i", { class: "dot" }); dot.style.background = d.c;
    lab.append(dot, d.k === "alterado" ? "Alterado SW" : d.k === "conferido" ? "Conferido" : d.t);
    b.append(el("b", { text: String(d.n) }), lab);
    b.onclick = () => { filtroStatus = (filtroStatus === d.k && d.k !== "abertas") ? "abertas" : d.k; desenhar(); };
    box.append(b);
  }
}
function renderProjetos(lista) {
  const projs = [...new Set(lista.map(i => i.projeto).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const sel = $("pendFiltroProj"), cur = filtroProj; sel.textContent = "";
  sel.append(el("option", { value: "", text: "Todos os projetos" }));
  for (const p of projs) sel.append(el("option", { value: p, text: p }));
  sel.value = projs.includes(cur) ? cur : ""; filtroProj = sel.value;
  const dl = $("listaProjetos"); dl.textContent = ""; for (const p of projs) dl.append(el("option", { value: p }));
}
function visiveis(lista) {
  const q = busca.trim().toLowerCase();
  return lista.filter(i => {
    if (filtroStatus === "abertas") { if (i.status === "gabaritado") return false; }
    else if (i.status !== filtroStatus) return false;
    if (filtroProj && i.projeto !== filtroProj) return false;
    if (q && !((i.peca || "") + " " + (i.alteracao || "") + " " + (i.nota || "") + " " + (i.projeto || "")).toLowerCase().includes(q)) return false;
    return true;
  });
}
function campos(d, comFoto, temFoto) {
  const iProj = el("input", { list: "listaProjetos", required: "", placeholder: "ESCARIFICADOR" }); iProj.value = d.projeto || "";
  const iPeca = el("input", { placeholder: "EM(0029) PAZINHA" }); iPeca.value = d.peca || "";
  const iAlt = el("textarea", { required: "", placeholder: "Ex.: furo de fixação 2 mm para a esquerda, não alinhou no protótipo" }); iAlt.value = d.alteracao || "";
  const iOri = el("select"); for (const o of new Set([...ORIGENS, d.origem || "Protótipo"])) iOri.append(el("option", { text: o })); iOri.value = d.origem || "Protótipo";
  const iPri = el("select"); for (const [k, t] of Object.entries(PRI)) iPri.append(el("option", { value: k, text: t })); iPri.value = d.prioridade || "media";
  const iPed = el("input", { placeholder: "Opcional" }); iPed.value = d.pedidoPor || "";
  const iFoto = el("input", { type: "file", accept: "image/*,video/*" });
  const nodos = [el("label", { text: "Projeto" }, iProj), el("label", { text: "Peça / código" }, iPeca),
    el("label", { class: "full", text: "O que alterar" }, iAlt), el("label", { text: "Origem" }, iOri),
    el("label", { text: "Prioridade" }, iPri), el("label", { text: "Pedido por" }, iPed)];
  if (comFoto) nodos.push(el("label", { text: temFoto ? "Trocar foto / vídeo" : "Foto ou vídeo" }, iFoto));
  const ler = () => ({ projeto: iProj.value, peca: iPeca.value, alteracao: iAlt.value, origem: iOri.value, prioridade: iPri.value, pedidoPor: iPed.value });
  return { nodos, ler, iFoto, iAlt, iProj };
}
function limpo(a) { return { ...a, projeto: a.projeto.trim().toUpperCase(), peca: a.peca.trim().toUpperCase(), alteracao: a.alteracao.trim(), pedidoPor: a.pedidoPor.trim() }; }

function formEditar(i, bEdit) {
  const f = el("form", { class: "add" }); f.hidden = !rascunhos[i.id];
  const c = campos(rascunhos[i.id] || i, true, !!i.fotoId);
  const msg = el("span", { class: "msg" });
  const bOk = el("button", { class: "btn primary", type: "submit", text: "Salvar alterações" });
  const bX = el("button", { class: "btn", type: "button", text: "Cancelar" });
  f.append(...c.nodos, el("div", { class: "row-end" }, msg, bX, bOk));
  f.oninput = () => { rascunhos[i.id] = c.ler(); };
  bX.onclick = () => { delete rascunhos[i.id]; desenhar(); };
  bEdit.onclick = () => { if (!f.hidden) { delete rascunhos[i.id]; desenhar(); return; } rascunhos[i.id] = c.ler(); f.hidden = false; c.iAlt.focus(); };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const a = c.ler();
    if (!a.projeto.trim() || !a.alteracao.trim()) { msg.className = "msg err"; msg.textContent = "Preencha o projeto e o que alterar."; return; }
    bOk.disabled = true; msg.className = "msg"; msg.textContent = "Salvando…";
    try {
      const patch = limpo(a);
      if (c.iFoto.files[0]) { msg.textContent = "Enviando foto…"; Object.assign(patch, await enviarMidia(c.iFoto.files[0], patch.projeto, patch.peca)); }
      delete rascunhos[i.id];
      salvar(i.id, patch);
    } catch (e) { msg.className = "msg err"; msg.textContent = e instanceof SemLogin ? "Login vencido: entre de novo." : e.message; bOk.disabled = false; if (e instanceof SemLogin) ACV.pedirLogin(); }
  };
  return f;
}

function card(i) {
  const st = STATUS.find(s => s.k === i.status) || STATUS[0];
  const c = el("article", { class: "card p-" + (i.prioridade || "media") + (i.status === "gabaritado" ? " done" : "") });
  const left = el("div", { class: "actions" });
  if (i.peca) left.append(el("span", { class: "code", text: i.peca }));
  left.append(el("span", { class: "pill s-" + st.k, text: st.t }));
  c.append(el("div", { class: "top" }, left, el("span", { class: "msg", text: "Prioridade " + (PRI[i.prioridade] || "Média") })),
    el("p", { class: "what", text: i.alteracao || "" }));
  const meta = el("div", { class: "meta" }, el("span", { text: "Origem: " + (i.origem || "—") }), el("span", { text: "Aberta " + fmtData(i.criado) }));
  if (i.pedidoPor) meta.append(el("span", { text: "Pedido por " + i.pedidoPor }));
  if (i.atualizado && i.atualizado !== i.criado) meta.append(el("span", { text: "Atualizada " + fmtData(i.atualizado) }));
  c.append(meta);
  if (i.nota) { const n = el("p", { class: "note" }); n.append(el("b", { text: "O que foi feito" }), i.nota); c.append(n); }
  if (i.fotoId) c.append(blocoMidia(i));
  const sel = el("select", { "aria-label": "Mudar status" });
  for (const s of STATUS) { const o = el("option", { value: s.k, text: s.t }); if (s.k === i.status) o.selected = true; sel.append(o); }
  sel.onchange = () => salvar(i.id, { status: sel.value });
  const bEdit = el("button", { class: "btn", type: "button", text: "Editar" });
  const bNota = el("button", { class: "btn", type: "button", text: i.nota ? "Editar nota" : "Anotar o que foi feito" });
  const bDel = el("button", { class: "btn danger", type: "button", text: "Excluir" });
  c.append(el("div", { class: "actions" }, sel, bEdit, bNota, bDel), formEditar(i, bEdit));
  const ta = el("textarea", { "aria-label": "O que foi feito" }); ta.value = i.nota || "";
  const bOk = el("button", { class: "btn primary", type: "button", text: "Salvar nota" });
  const bX = el("button", { class: "btn", type: "button", text: "Cancelar" });
  const edit = el("div", { class: "editbox" }, ta, el("div", { class: "actions" }, bOk, bX)); edit.hidden = true; c.append(edit);
  bNota.onclick = () => { edit.hidden = false; ta.focus(); };
  bX.onclick = () => { edit.hidden = true; ta.value = i.nota || ""; };
  bOk.onclick = () => salvar(i.id, { nota: ta.value.trim() });
  const bSim = el("button", { class: "btn danger", type: "button", text: "Sim, excluir" });
  const bNao = el("button", { class: "btn", type: "button", text: "Manter" });
  const conf = el("div", { class: "actions" }, el("span", { class: "msg", text: "Excluir esta pendência?" }), bSim, bNao); conf.hidden = true; c.append(conf);
  bDel.onclick = () => { conf.hidden = false; };
  bNao.onclick = () => { conf.hidden = true; };
  bSim.onclick = () => registrar({ tipo: "del", id: i.id });
  return c;
}

function desenhar() {
  $("pendImportar").hidden = situacao !== "importar";
  $("pendConteudo").hidden = situacao === "importar";
  if (situacao === "importar") return;
  const todos = itens();
  renderStats(todos); renderProjetos(todos);
  const lista = $("pendLista"); lista.textContent = "";
  if (!dados) { lista.append(el("p", { class: "msg", text: "Carregando…" })); return; }
  if (!todos.length) { lista.append(el("div", { class: "empty" }, el("strong", { text: "Nenhuma pendência ainda" }), el("span", { text: "Toque em “+ Nova pendência” ou peça ao Claude: “anota no escarificador: …”." }))); return; }
  const vis = visiveis(todos);
  if (!vis.length) { lista.append(el("div", { class: "empty" }, el("strong", { text: "Nada neste filtro" }), el("span", { text: "Troque o status ou o projeto acima." }))); return; }
  const grupos = {};
  for (const i of vis) (grupos[i.projeto || "Sem projeto"] ||= []).push(i);
  for (const p of Object.keys(grupos).sort((a, b) => a.localeCompare(b, "pt-BR"))) {
    const arr = grupos[p].sort((a, b) => (PRI_ORD[a.prioridade] ?? 1) - (PRI_ORD[b.prioridade] ?? 1) || String(b.criado).localeCompare(String(a.criado)));
    const g = el("section", { class: "group" }, el("h2", {}, p, " ", el("small", { text: arr.length + (arr.length === 1 ? " item" : " itens") })));
    for (const i of arr) g.append(card(i));
    lista.append(g);
  }
}

// ---------- nova pendência ----------
let campoNovo = null;
function montarFormNovo() {
  const f = $("pendFormNova"); f.textContent = "";
  campoNovo = campos({}, true, false);
  const msg = el("span", { class: "msg", id: "pendFormMsg" });
  const bX = el("button", { class: "btn", type: "button", text: "Cancelar" });
  const bOk = el("button", { class: "btn primary", type: "submit", text: "Salvar pendência" });
  f.append(...campoNovo.nodos, el("div", { class: "row-end" }, msg, bX, bOk));
  bX.onclick = () => { f.hidden = true; montarFormNovo(); };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const a = campoNovo.ler();
    if (!a.projeto.trim() || !a.alteracao.trim()) { msg.className = "msg err"; msg.textContent = "Preencha o projeto e o que alterar."; return; }
    bOk.disabled = true; msg.className = "msg"; msg.textContent = "Salvando…";
    try {
      const agora = new Date().toISOString();
      const item = { id: novoId(), ...limpo(a), status: "pendente", nota: "", criado: agora, atualizado: agora };
      if (campoNovo.iFoto.files[0]) { msg.textContent = "Enviando foto…"; Object.assign(item, await enviarMidia(campoNovo.iFoto.files[0], item.projeto, item.peca)); }
      f.hidden = true; montarFormNovo();
      registrar({ tipo: "add", item });
      window.scrollTo(0, 0);
    } catch (e) { msg.className = "msg err"; msg.textContent = e instanceof SemLogin ? "Login vencido: entre de novo." : e.message; bOk.disabled = false; if (e instanceof SemLogin) ACV.pedirLogin(); }
  };
}
montarFormNovo();
$("pendFiltroProj").onchange = e => { filtroProj = e.target.value; desenhar(); };
$("pendBusca").oninput = e => { busca = e.target.value; desenhar(); };

// ---------- primeira vez: importar o pacote de migração ou começar vazio ----------
async function criarLista(itensIniciais, midiasPacote) {
  const st = $("pendImpMsg");
  const pasta = await drive.pasta(PASTA);
  const pastaFotos = await drive.pasta("FOTOS", pasta);
  const lista = JSON.parse(JSON.stringify(itensIniciais));
  const comFoto = lista.filter(i => i.fotoId && midiasPacote[i.fotoId]);
  let n = 0;
  for (const i of comFoto) {
    st.textContent = "Enviando fotos e vídeos: " + (++n) + " de " + comFoto.length + "…";
    const m = midiasPacote[i.fotoId];
    const blob = await (await fetch("data:" + m.tipo + ";base64," + m.base64)).blob();
    i.fotoId = await drive.criar(m.nome, pastaFotos, blob, m.tipo);
    i.fotoTipo = m.tipo;
  }
  for (const i of lista) if (i.fotoId && !i.fotoTipo) { delete i.fotoId; }   // foto que não veio no pacote
  st.textContent = "Criando a lista…";
  const d = { formato: "acaves-pendencias-1", pasta, pastaFotos, atualizado: new Date().toISOString(), itens: lista };
  await drive.criar(NOME, pasta, JSON.stringify(d, null, 1), "application/json");
  st.textContent = "";
  toast("Lista criada no Drive com " + lista.length + " pendência(s).");
  sincronizar(true);
}
$("pendPacote").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (p.formato !== "acaves-pendencias-migracao-1" || !Array.isArray(p.itens)) throw new Error("Esse arquivo não é o pacote de migração das pendências.");
    await criarLista(p.itens, p.midias || {});
  } catch (er) { $("pendImpMsg").textContent = ""; if (er instanceof SemLogin) ACV.entrar(); else toast(er.message, 6000); }
};
$("pendVazia").onclick = async () => {
  if (!confirm("Começar uma lista vazia no Drive?")) return;
  try { await criarLista([], {}); } catch (er) { if (er instanceof SemLogin) ACV.entrar(); else toast(er.message, 6000); }
};

window.Pendencias = {
  sincronizar, desenhar,
  novo: () => { const f = $("pendFormNova"); f.hidden = false; f.scrollIntoView({ behavior: "smooth" }); setTimeout(() => campoNovo.iProj.focus(), 300); },
  estado: () => (fila.length ? fila.length + " alteração(ões) a enviar" : (sinc ? "Drive " + sinc : "")),
  temDados: () => dados !== null
};
})();
