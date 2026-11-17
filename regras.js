// Aba REGRAS — lê e grava o REGRAS DE PROJETO.md no Google Drive.
// Alterações viram "operações" numa fila local; sem internet ou com login vencido ficam guardadas
// e são aplicadas depois sobre a versão mais nova do arquivo.
(() => {
"use strict";
const { CFG, loc, $, toast, hoje, agoraCurto, esc, SemLogin, drive } = ACV;
const CAIXA = "CAIXA DE ENTRADA — regras novas (a classificar)";
const NOME = CFG.NOME_ARQUIVO || "REGRAS DE PROJETO.md";

let texto = loc.ler("regTexto", null);
let fila = loc.ler("regFila", []);
let sinc = loc.ler("regSinc", null);
let editando = null, sincronizando = false, situacao = "carregando";   // carregando | importar | pronto | login

// ---------- Markdown: seções e operações ----------
function secoes(md) {
  const out = []; let atual = { titulo: null, linhas: [] };
  md.split("\n").forEach(l => {
    if (/^## /.test(l)) { out.push(atual); atual = { titulo: l.slice(3).trim(), cab: l, linhas: [] }; }
    else atual.linhas.push(l);
  });
  out.push(atual);
  return out;
}
function juntar(lista) {
  return lista.map(s => (s.titulo === null ? "" : (s.cab || "## " + s.titulo) + "\n") + s.linhas.join("\n")).join("\n").replace(/^\n/, "");
}
function corpo(sec) { return sec.linhas.join("\n"); }
function separarRabo(linhas) {
  let k = linhas.length;
  while (k > 0 && (/^\s*$/.test(linhas[k - 1]) || /^---\s*$/.test(linhas[k - 1]))) k--;
  return [linhas.slice(0, k), linhas.slice(k)];
}
function aplicar(md, op) {
  const lista = secoes(md);
  if (op.tipo === "add") {
    let sec = lista.find(s => s.titulo === op.secao);
    if (!sec && op.secao === CAIXA) {
      sec = { titulo: CAIXA, linhas: ["", "Regras escritas pelo celular. O Claude classifica cada uma no assunto certo e propaga para a skill/agente.", "", "---", ""] };
      lista.splice(Math.min(1, lista.length), 0, sec);
    }
    if (!sec) throw new Error('O assunto "' + op.secao + '" não existe mais no arquivo. A regra ficou na Caixa de entrada.');
    const [miolo, rabo] = separarRabo(sec.linhas);
    if (miolo.length && !/^\s*$/.test(miolo[miolo.length - 1]) && !/^\s*([-*]|\d+\.)\s/.test(miolo[miolo.length - 1])) miolo.push("");
    const regra = op.texto.trim().replace(/\s*\n\s*/g, " ");
    let ultimoNum = null;              // continua a numeração se o assunto for lista numerada
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
function textoVisivel() {
  let md = texto || "";
  for (const op of fila) { try { md = aplicar(md, op); } catch { } }
  return md;
}

// ---------- Markdown: desenho ----------
function inline(s) { return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"); }
function renderizar(md) {
  const linhas = md.split("\n"); let html = "", i = 0; const pilha = []; let par = [];
  const fecharListas = (ate = -1) => { while (pilha.length && pilha[pilha.length - 1].ind > ate) html += "</li></" + pilha.pop().tag + ">"; };
  const fecharPar = () => { if (par.length) { html += "<p>" + inline(par.join(" ")) + "</p>"; par = []; } };
  while (i < linhas.length) {
    const l = linhas[i], m = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (/^\s*\|/.test(l)) {
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
      const ind = m[1].replace(/\t/g, "  ").length, tag = /\d/.test(m[2]) ? "ol" : "ul", topo = pilha[pilha.length - 1];
      if (!topo || ind > topo.ind) { html += "<" + tag + "><li>"; pilha.push({ ind, tag }); }
      else { fecharListas(ind); html += "</li><li>"; }
      html += inline(m[3]);
    } else if (/^#{3,6}\s/.test(l)) { fecharPar(); fecharListas(); html += "<h4>" + inline(l.replace(/^#+\s*/, "")) + "</h4>"; }
    else if (/^---\s*$/.test(l)) { fecharPar(); fecharListas(); }
    else if (/^\s*$/.test(l)) { fecharPar(); }
    else if (pilha.length && /^\s+\S/.test(l)) { html += " " + inline(l.trim()); }
    else { fecharListas(); par.push(l.trim()); }
    i++;
  }
  fecharPar(); fecharListas();
  return html;
}

function desenhar() {
  $("regImportar").hidden = situacao !== "importar";
  $("regConteudo").hidden = situacao === "importar";
  if (situacao === "importar") return;
  const lista = secoes(textoVisivel()), q = $("regBusca").value.trim().toLowerCase();
  const abertos = new Set([...document.querySelectorAll("#regLista details.secao[open]")].map(d => d.dataset.t));
  const el = $("regLista"); el.innerHTML = "";
  if (texto === null) { el.innerHTML = "<p class='aviso-texto'>Carregando…</p>"; return; }
  if (q) {
    let n = 0;
    const rx = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    lista.forEach(s => s.linhas.forEach(l => {
      if (l.trim() && l.toLowerCase().includes(q)) {
        n++;
        const d = document.createElement("div"); d.className = "achado";
        d.innerHTML = inline(l.replace(/^\s*([-*]|\d+\.)\s+/, "")).replace(rx, "<mark>$1</mark>") + "<small>" + esc(s.titulo || "Cabeçalho") + "</small>";
        el.appendChild(d);
      }
    }));
    if (!n) el.innerHTML = "<p class='aviso-texto'>Nada encontrado.</p>";
    return;
  }
  lista.forEach(s => {
    if (s.titulo === null) return;
    const d = document.createElement("details"); d.className = "secao"; d.dataset.t = s.titulo;
    if (abertos.has(s.titulo)) d.open = true;
    const n = s.linhas.filter(l => /^([-*]|\d+\.)\s/.test(l)).length;
    d.innerHTML = "<summary><span>" + inline(s.titulo) + "</span><span class='n'>" + n + "</span></summary><div class='corpo'>" + renderizar(corpo(s)) +
      "<div class='acoes-secao'><button class='btn' data-add>+ Regra aqui</button><button class='btn' data-edit>Editar texto</button></div></div>";
    d.querySelector("[data-add]").onclick = () => abrirNova(s.titulo);
    d.querySelector("[data-edit]").onclick = () => abrirEditar(s.titulo);
    el.appendChild(d);
  });
}

// ---------- sincronização ----------
async function sincronizar(silencioso) {
  if (sincronizando) return;
  if (!ACV.DEMO && !navigator.onLine) { if (!silencioso) toast("Sem internet: as alterações ficam guardadas no celular."); return; }
  sincronizando = true;
  try {
    const id = await drive.achar(NOME, "regId");
    if (!id) { situacao = "importar"; desenhar(); return; }
    const bruto = await drive.texto(id);
    const crlf = bruto.includes("\r\n");
    let md = bruto.replace(/^﻿/, "").replace(/\r\n/g, "\n");
    if (fila.length) {
      const problemas = [];
      for (const op of fila) {
        try { md = aplicar(md, op); }
        catch (e) {
          problemas.push(e.message);
          const resgate = op.tipo === "add" ? op.texto : "(edição não aplicada de \"" + op.secao + "\") " + op.depois;
          md = aplicar(md, { tipo: "add", secao: CAIXA, texto: resgate, data: op.data || hoje() });
        }
      }
      await drive.salvarTexto(id, crlf ? md.replace(/\n/g, "\r\n") : md, "text/markdown");
      fila = []; loc.gravar("regFila", fila);
      if (problemas.length) alert("Algumas alterações bateram com mudanças feitas no computador e foram para a Caixa de entrada:\n\n" + problemas.join("\n"));
      else if (!silencioso) toast("Regra salva no Drive.");
    }
    texto = md; loc.gravar("regTexto", texto);
    sinc = agoraCurto(); loc.gravar("regSinc", sinc);
    situacao = "pronto"; desenhar();
  } catch (e) {
    if (e instanceof SemLogin) { situacao = "login"; ACV.pedirLogin(); }
    else toast(e.message, 6000);
  } finally { sincronizando = false; ACV.atualizarEstado(); }
}
function registrar(op) { fila.push(op); loc.gravar("regFila", fila); desenhar(); sincronizar(false); }

// ---------- janelas ----------
function abrirNova(secao) {
  const sel = $("selSecao"); sel.innerHTML = "";
  const titulos = secoes(textoVisivel()).map(s => s.titulo).filter(t => t !== null);
  if (!titulos.includes(CAIXA)) titulos.unshift(CAIXA);
  titulos.forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o); });
  sel.value = secao || loc.ler("regUltimaSecao", CAIXA);
  if (!sel.value) sel.value = CAIXA;
  $("txtRegra").value = loc.ler("regRascunho", "");
  ACV.abrirModal("modalNova");
  setTimeout(() => $("txtRegra").focus(), 50);
}
$("txtRegra").addEventListener("input", () => loc.gravar("regRascunho", $("txtRegra").value));
$("btSalvarNova").onclick = () => {
  const t = $("txtRegra").value.trim();
  if (!t) { toast("Escreva a regra."); return; }
  const secao = $("selSecao").value;
  loc.gravar("regUltimaSecao", secao); loc.apagar("regRascunho");
  ACV.fecharModais();
  registrar({ tipo: "add", secao, texto: t, data: hoje() });
};
function abrirEditar(secao) {
  const s = secoes(textoVisivel()).find(x => x.titulo === secao);
  if (!s) return;
  editando = { secao, antes: corpo(s) };
  $("tituloEditar").textContent = secao;
  $("txtEditar").value = editando.antes;
  ACV.abrirModal("modalEditar");
}
$("btSalvarEditar").onclick = () => {
  const depois = $("txtEditar").value.replace(/\r\n/g, "\n");
  ACV.fecharModais();
  if (!editando || depois === editando.antes) return;
  registrar({ tipo: "editar", secao: editando.secao, antes: editando.antes, depois, data: hoje() });
  editando = null;
};
$("regArquivo").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const md = (await f.text()).replace(/^﻿/, "");
  if (!/^## /m.test(md)) { toast("Esse arquivo não parece o REGRAS DE PROJETO.md (não tem títulos ##)."); return; }
  try { const pasta = await drive.pasta(CFG.NOME_PASTA || "ACAVES - REGRAS"); await drive.criar(NOME, pasta, md, "text/markdown"); toast("Arquivo criado no Drive."); sincronizar(true); }
  catch (er) { if (er instanceof SemLogin) ACV.entrar(); else toast(er.message, 6000); }
};
$("regBusca").addEventListener("input", desenhar);

window.Regras = {
  sincronizar, desenhar,
  novo: () => abrirNova(null),
  estado: () => (fila.length ? fila.length + " regra(s) a enviar" : (sinc ? "Drive " + sinc : "")),
  temDados: () => texto !== null
};
})();
