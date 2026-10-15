import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, deleteDoc, collection,
  query, where, onSnapshot, writeBatch, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
import { CALENDARIO, CLUBE, EQUIPAS } from "./calendario.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
if (firebaseConfig.projectId.startsWith("demo-")) {
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, location.hostname, 8080);
}

/* ---------- Utilitários ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const toDate = x => (x && typeof x.toDate === "function") ? x.toDate() : (x instanceof Date ? x : new Date(x));
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtDia = d => `${DIAS[d.getDay()]}, ${d.getDate()} ${MESES[d.getMonth()]}`;
const fmtHora = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDH = d => `${fmtDia(d)}, ${fmtHora(d)}`;
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const jid = n => "J" + pad(n);
const RE_NOME = /^[\p{L}0-9]+([ ._-][\p{L}0-9]+)*$/u;
const limparNome = s => String(s || "").trim().replace(/\s+/g, " ");

function falta(ms) {
  if (ms <= 0) return "fechado";
  const min = Math.floor(ms / 60000), h = Math.floor(min / 60), d = Math.floor(h / 24);
  if (d >= 1) return `faltam ${d} ${d === 1 ? "dia" : "dias"} e ${h % 24} h`;
  if (h >= 1) return `faltam ${h} h ${pad(min % 60)} min`;
  return `faltam ${Math.max(1, min)} min`;
}

// Regulamento: fecha sexta às 21:00; se algum jogo começar antes disso, fecha às 12:30 do dia desse jogo.
function prazoPadrao(primeiro) {
  const d = new Date(primeiro);
  const dow = (d.getDay() + 6) % 7; // segunda = 0
  const sexta = new Date(d); sexta.setDate(d.getDate() - dow + 4); sexta.setHours(21, 0, 0, 0);
  if (d < sexta) { const p = new Date(d); p.setHours(12, 30, 0, 0); return p; }
  return sexta;
}
// Abre na segunda-feira dessa semana (ou quando fecha a jornada anterior, se for mais tarde).
function aberturaPadrao(primeiro, prazoAnterior) {
  const d = new Date(primeiro);
  const dow = (d.getDay() + 6) % 7;
  const seg = new Date(d); seg.setDate(d.getDate() - dow); seg.setHours(0, 0, 0, 0);
  return prazoAnterior && prazoAnterior > seg ? new Date(prazoAnterior) : seg;
}

let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4000);
}

function msgErroAuth(e) {
  const m = {
    "auth/email-already-in-use": "Já existe uma conta com este email. Usa \"Entrar\".",
    "auth/invalid-email": "Esse email não parece válido.",
    "auth/missing-email": "Escreve o teu email.",
    "auth/weak-password": "A palavra-passe tem de ter pelo menos 6 caracteres.",
    "auth/missing-password": "Escreve a palavra-passe.",
    "auth/invalid-credential": "Email ou palavra-passe errados.",
    "auth/wrong-password": "Email ou palavra-passe errados.",
    "auth/user-not-found": "Não há nenhuma conta com este email.",
    "auth/too-many-requests": "Demasiadas tentativas. Espera uns minutos e tenta outra vez.",
    "auth/network-request-failed": "Sem ligação à internet. Verifica a rede e tenta outra vez."
  };
  return m[e?.code] || "Algo correu mal. Tenta outra vez.";
}

/* ---------- Estado ---------- */
const S = {
  user: null, perfil: undefined, bloqueio: undefined, adminUid: undefined,
  jornadas: [], meus: {}, resultados: [], perfis: {},
  tab: "boletim", rascunho: {}, aGuardar: false,
  modo: "entrar", f: {}, erroEntrar: "", okEntrar: "", erroNome: "", aEntrar: false,
  abertos: new Set(),
  todosPalpites: [], privados: {}, bloqueados: {}, edit: null, confirmar: null, importDe: null, ocupado: false,
  pendente: false
};
try { const t = localStorage.getItem("totoreal-tab"); if (t) S.tab = t; } catch {}

let unsubs = [], unsubsAdmin = [];
const souAdmin = () => !!S.user && S.adminUid === S.user.uid;
const nomeDe = uid => S.perfis[uid]?.nome || "";
const resMap = () => Object.fromEntries(S.resultados.map(r => [r.id, r]));

function pararAdmin() { unsubsAdmin.forEach(u => u()); unsubsAdmin = []; }
function iniciarAdmin() {
  if (unsubsAdmin.length) return;
  // Se uma escuta falhar (por exemplo logo a seguir a ficar admin), volta a tentar.
  const erro = e => { console.error(e); pararAdmin(); setTimeout(() => { if (souAdmin()) iniciarAdmin(); }, 3000); };
  unsubsAdmin.push(onSnapshot(collection(db, "palpites"), s => { S.todosPalpites = s.docs.map(d => d.data()); render(); }, erro));
  unsubsAdmin.push(onSnapshot(collection(db, "privado"), s => { S.privados = {}; s.forEach(d => { S.privados[d.id] = d.data(); }); render(); }, erro));
  unsubsAdmin.push(onSnapshot(collection(db, "bloqueados"), s => { S.bloqueados = {}; s.forEach(d => { S.bloqueados[d.id] = d.data(); }); render(); }, erro));
}

onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = []; pararAdmin();
  Object.assign(S, {
    user, perfil: undefined, bloqueio: undefined, adminUid: undefined, jornadas: [], meus: {}, resultados: [], perfis: {},
    rascunho: {}, edit: null, confirmar: null, todosPalpites: [], privados: {}, bloqueados: {}
  });
  if (!user) return render(true);
  const uid = user.uid;
  const ouvir = (ref, fn) => unsubs.push(onSnapshot(ref, fn, e => console.error(e)));
  ouvir(doc(db, "perfis", uid), s => { S.perfil = s.exists() ? s.data() : null; render(); });
  ouvir(doc(db, "bloqueados", uid), s => { S.bloqueio = s.exists() ? s.data() : null; render(); });
  unsubs.push(onSnapshot(doc(db, "config", "admin"), { includeMetadataChanges: true }, s => {
    S.adminUid = s.exists() ? s.data().uid : null;
    if (!souAdmin()) pararAdmin();
    else if (!s.metadata.hasPendingWrites) iniciarAdmin();
    render();
  }, e => console.error(e)));
  ouvir(collection(db, "jornadas"), s => {
    S.jornadas = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.numero - b.numero);
    render();
  });
  ouvir(collection(db, "resultados"), s => {
    S.resultados = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.numero - a.numero);
    render();
  });
  ouvir(collection(db, "perfis"), s => { const p = {}; s.forEach(d => { p[d.id] = d.data(); }); S.perfis = p; render(); });
  ouvir(query(collection(db, "palpites"), where("uid", "==", uid)), s => {
    const m = {}; s.forEach(d => { const p = d.data(); m[p.jornada] = p; }); S.meus = m; render();
  });
});

/* ---------- Jornadas ---------- */
function jogosAtivos(j) {
  const r = j.resultados || {};
  return (j.jogos || []).filter(g => r[g.id] !== "A").slice().sort((a, b) => toDate(a.inicio) - toDate(b.inicio));
}
function estadoJornada(j, agora = Date.now()) {
  if (resMap()[j.id]) return "concluida";
  if (agora < toDate(j.abertura).getTime()) return "por-abrir";
  if (agora < toDate(j.prazo).getTime()) return "aberta";
  return "fechada";
}
const ROT_ESTADO = { "por-abrir": "Por abrir", aberta: "Aberta", fechada: "À espera de resultados", concluida: "Resultados saíram" };
function jornadaAtual() {
  const agora = Date.now();
  const aberta = S.jornadas.find(j => estadoJornada(j, agora) === "aberta");
  if (aberta) return aberta;
  const fechadas = S.jornadas.filter(j => estadoJornada(j, agora) === "fechada");
  if (fechadas.length) return fechadas[fechadas.length - 1];
  return S.jornadas.find(j => estadoJornada(j, agora) === "por-abrir") || null;
}
function escolhaEfetiva(j, gid) {
  const r = S.rascunho[j.id];
  if (r && r[gid]) return r[gid];
  return S.meus[j.id]?.escolhas?.[gid] || null;
}
function alterado(j) {
  const r = S.rascunho[j.id] || {};
  const guardado = S.meus[j.id]?.escolhas || {};
  return Object.entries(r).some(([g, v]) => guardado[g] !== v);
}

function gerarJornadas(aPartirDe) {
  const out = []; let prazoAnt = null;
  for (const c of CALENDARIO.filter(c => c.numero >= aPartirDe)) {
    const toto = c.jogos.filter(g => g.casa !== CLUBE && g.fora !== CLUBE).sort((a, b) => a.inicio.localeCompare(b.inicio));
    const nosso = c.jogos.find(g => g.casa === CLUBE || g.fora === CLUBE);
    const primeiro = new Date(toto[0].inicio);
    const prazo = prazoPadrao(primeiro);
    const abertura = aberturaPadrao(primeiro, prazoAnt);
    out.push({
      id: jid(c.numero), numero: c.numero,
      abertura: Timestamp.fromDate(abertura), prazo: Timestamp.fromDate(prazo),
      realense: nosso ? `${nosso.casa} – ${nosso.fora}` : "Realense folga",
      jogos: toto.map((g, i) => ({ id: "g" + (i + 1), casa: g.casa, fora: g.fora, inicio: Timestamp.fromDate(new Date(g.inicio)) })),
      resultados: {}
    });
    prazoAnt = prazo;
  }
  return out;
}

/* ---------- Render ---------- */
function render(forcar) {
  const app = $("#app");
  const ae = document.activeElement;
  if (!forcar && ae && app.contains(ae) && ae.matches("input, select, textarea")) { S.pendente = true; return; }
  S.pendente = false;
  app.innerHTML = html();
}
document.addEventListener("focusout", () => setTimeout(() => {
  if (S.pendente && !(document.activeElement && document.activeElement.matches("input, select, textarea"))) render(true);
}, 0));
setInterval(() => { if (S.user && (S.tab === "boletim" || S.tab === "admin")) render(); }, 30000);

function html() {
  if (!S.user) return vistaEntrar();
  if (S.perfil === undefined || S.bloqueio === undefined) return `<div class="carregar">A abrir o TotoReal…</div>`;
  if (S.bloqueio) {
    return topo(false) + `<main class="gutter"><div class="col pilha">${aviso(
      S.bloqueio.apagado ? "Conta removida" : "Conta bloqueada",
      "O administrador do TotoReal tirou-te o acesso. Se achas que é engano, fala com ele."
    )}</div></main>`;
  }
  if (S.perfil === null) return vistaNome();
  let corpo;
  if (S.tab === "resultados") corpo = vistaResultados();
  else if (S.tab === "classificacao") corpo = vistaClassificacao();
  else if (S.tab === "admin" && souAdmin()) corpo = vistaAdmin();
  else { S.tab = "boletim"; corpo = vistaBoletim(); }
  return topo(true) + `<main class="gutter"><div class="col pilha">${bannerAdmin()}${corpo}</div></main>` + barraGuardar();
}

function aviso(t, p, extra = "") {
  return `<div class="aviso"><h2>${t}</h2><p>${p}</p>${extra}</div>`;
}

function topo(comTabs) {
  const tabs = [["boletim", "Boletim"], ["resultados", "Resultados"], ["classificacao", "Classificação"]];
  return `<header class="topo gutter">
    <div class="col">
      <div><h1 class="logo">Toto<span>Real</span></h1><div class="sub-logo">Realense FC · 1.ª Distrital AF Braga, Série A</div></div>
      <div class="quem"><b>${esc(S.perfil?.nome || S.user.email)}</b>${souAdmin() && comTabs ? `<button data-tab="admin" ${S.tab === "admin" ? `aria-current="page"` : ""}>Admin</button> · ` : ""}<button data-acao="sair">Sair</button></div>
    </div>
    ${comTabs ? `<nav class="col tabs" role="tablist">${tabs.map(([k, r]) =>
      `<button class="tab" role="tab" aria-selected="${S.tab === k}" data-tab="${k}">${r}</button>`).join("")}</nav>` : ""}
  </header>`;
}

function bannerAdmin() {
  if (S.adminUid !== null) return "";
  return `<div class="cartao"><p class="eyebrow">Configuração</p>
    <p style="margin:6px 0 12px">Ainda não há administrador. Se és tu quem organiza o TotoReal, fica já com esse papel.</p>
    <button class="btn" data-acao="ser-admin">Ficar como administrador</button></div>`;
}

/* Entrar / criar conta */
function vistaEntrar() {
  const m = S.modo, f = S.f;
  const titulo = { entrar: "Entrar", criar: "Criar conta", recuperar: "Recuperar palavra-passe" }[m];
  return `<main class="gutter"><div class="entrar">
    <div class="marca-grande">
      <h1 class="logo">Toto<span>Real</span></h1>
      <p>O totoloto semanal do Realense FC</p>
      <div class="fichas" aria-hidden="true"><b>1</b><b class="on">X</b><b>2</b></div>
    </div>
    <div class="cartao">
      <form id="f-entrar" novalidate>
        <h2 class="eyebrow">${titulo}</h2>
        ${m === "criar" ? `<div class="campo"><label for="e-nome">Nome que os outros vão ver</label>
          <input id="e-nome" name="nome" maxlength="20" autocomplete="nickname" value="${esc(f.nome)}" placeholder="Ex.: Salvador">
          <small>Entre 2 e 20 letras ou números.</small></div>` : ""}
        <div class="campo"><label for="e-email">Email</label>
          <input id="e-email" name="email" type="email" autocomplete="email" inputmode="email" value="${esc(f.email)}" placeholder="o.teu@email.com"></div>
        ${m !== "recuperar" ? `<div class="campo"><label for="e-pass">Palavra-passe</label>
          <input id="e-pass" name="pass" type="password" autocomplete="${m === "criar" ? "new-password" : "current-password"}" placeholder="${m === "criar" ? "Pelo menos 6 caracteres" : ""}"></div>` : ""}
        ${S.erroEntrar ? `<div class="erro-msg" role="alert">${esc(S.erroEntrar)}</div>` : ""}
        ${S.okEntrar ? `<div class="ok-msg" role="status">${esc(S.okEntrar)}</div>` : ""}
        <button class="btn" type="submit" ${S.aEntrar ? "disabled" : ""}>${m === "recuperar" ? "Enviar email" : titulo}</button>
      </form>
    </div>
    <p class="troca">
      ${m === "entrar" ? `Ainda não tens conta? <button class="link" data-modo="criar">Criar conta</button><br><button class="link" data-modo="recuperar">Esqueci-me da palavra-passe</button>`
        : `Já tens conta? <button class="link" data-modo="entrar">Entrar</button>`}
    </p>
  </div></main>`;
}

function vistaNome() {
  return topo(false) + `<main class="gutter"><div class="col pilha"><div class="cartao">
    <form id="f-nome" novalidate>
      <p class="eyebrow">Último passo</p>
      <h2 class="titulo" style="font-size:28px">Escolhe o teu nome</h2>
      <p class="nota">É o nome que aparece a toda a gente nos resultados e na classificação.</p>
      <div class="campo"><label for="n-nome">Nome</label>
        <input id="n-nome" name="nome" maxlength="20" autocomplete="nickname" value="${esc(S.f.nome)}" placeholder="Ex.: Salvador"></div>
      ${S.erroNome ? `<div class="erro-msg" role="alert">${esc(S.erroNome)}</div>` : ""}
      <button class="btn" type="submit">Guardar nome</button>
    </form></div></div></main>`;
}

/* Boletim */
function vistaBoletim() {
  if (!S.jornadas.length) {
    return aviso("Ainda não há jornadas", souAdmin()
      ? "Vai ao separador Admin e importa o calendário da Série A."
      : "O administrador ainda não lançou a primeira jornada. Volta na segunda-feira.");
  }
  const j = jornadaAtual();
  if (!j) return aviso("Época terminada", "Já não há jornadas por jogar. Vê quem ganhou na classificação.");
  const est = estadoJornada(j);
  const agora = Date.now();
  const prazo = toDate(j.prazo), abertura = toDate(j.abertura);
  const ativos = jogosAtivos(j);
  const meu = S.meus[j.id];
  const podeMarcar = est === "aberta";
  const res = j.resultados || {};

  let cabDir;
  if (est === "aberta") {
    const ms = prazo - agora;
    cabDir = `<div class="prazo ${ms < 6 * 3600e3 ? "urgente" : ""}">Fecha ${esc(fmtDH(prazo))}<b>${falta(ms)}</b></div>`;
  } else if (est === "por-abrir") {
    cabDir = `<div class="prazo">Abre<b>${esc(fmtDH(abertura))}</b></div>`;
  } else {
    cabDir = `<div class="prazo">Fechou<b>${esc(fmtDH(prazo))}</b></div>`;
  }

  const linhas = ativos.map((g, i) => {
    const e = escolhaEfetiva(j, g.id);
    const d = toDate(g.inicio);
    return `<div class="bol-linha">
      <span class="num">${i + 1}</span>
      <div class="jogo"><div class="eq">${esc(g.casa)}</div><div class="eq">${esc(g.fora)}</div>
        <div class="quando">${esc(fmtDH(d))}</div></div>
      <div class="marcas" role="group" aria-label="${esc(g.casa)} contra ${esc(g.fora)}">
        ${["1", "X", "2"].map(v => `<button class="marca${res[g.id] === v ? " real" : ""}" data-acao="marcar" data-j="${j.id}" data-g="${g.id}" data-v="${v}"
          aria-pressed="${e === v}" ${podeMarcar ? "" : "disabled"}>${v}</button>`).join("")}
      </div>
    </div>`;
  }).join("");

  let pe = "";
  if (est === "por-abrir") pe = `<span class="estado">Podes preencher o boletim a partir de ${esc(fmtDH(abertura))}.</span>`;
  else if (est === "fechada") pe = meu
    ? `<span class="estado ok">Boletim registado. Os resultados saem quando o administrador os lançar.</span>`
    : `<span class="estado">Não registaste boletim nesta jornada.</span>`;

  const proxima = S.jornadas.find(x => x.numero > j.numero && estadoJornada(x) === "por-abrir");
  return `<div class="cab-jornada">
      <div><p class="eyebrow">${esc(ROT_ESTADO[est])}</p><h2 class="titulo">Jornada ${j.numero}</h2></div>
      ${cabDir}
    </div>
    <div class="boletim">
      <div class="bol-cab"><span></span><span>Jogo</span><span class="tres"><b>1</b><b>X</b><b>2</b></span></div>
      ${linhas || `<div class="bol-linha"><span></span><span class="nota">Esta jornada não tem jogos.</span><span></span></div>`}
      ${pe ? `<div class="bol-pe">${pe}</div>` : ""}
    </div>
    <div class="extra">
      <span>Fora do TotoReal: ${esc(j.realense || "jogo do Realense")}</span>
      <span>Só ganha quem acertar nos ${ativos.length} jogos.</span>
    </div>
    ${est !== "aberta" && proxima ? `<p class="nota">A Jornada ${proxima.numero} abre ${esc(fmtDH(toDate(proxima.abertura)))}.</p>` : ""}`;
}

function barraGuardar() {
  if (S.tab !== "boletim" || S.bloqueio || !S.perfil) return "";
  const j = jornadaAtual();
  if (!j || estadoJornada(j) !== "aberta") return "";
  const ativos = jogosAtivos(j);
  const faltam = ativos.filter(g => !escolhaEfetiva(j, g.id)).length;
  const meu = S.meus[j.id];
  const mudou = alterado(j);
  let txt, pode = false, rot = "Registar boletim";
  if (faltam) txt = `Falta${faltam === 1 ? "" : "m"} ${faltam} ${faltam === 1 ? "jogo" : "jogos"} por marcar`;
  else if (!meu) { txt = "Boletim completo"; pode = true; }
  else if (mudou) { txt = "Tens alterações por registar"; pode = true; rot = "Registar alterações"; }
  else { txt = `Registado. Podes mudar até ${fmtDH(toDate(j.prazo))}.`; rot = "Registado"; }
  return `<div class="barra-guardar gutter"><div class="col">
    <span class="estado">${esc(txt)}</span>
    <button class="btn" data-acao="guardar" data-j="${j.id}" ${pode && !S.aGuardar ? "" : "disabled"}>${S.aGuardar ? "A registar…" : rot}</button>
  </div></div>`;
}

/* Resultados */
function vistaResultados() {
  if (!S.resultados.length) return aviso("Ainda sem resultados", "Os resultados de cada jornada aparecem aqui quando o administrador os lançar. Nessa altura também vês o boletim de toda a gente.");
  return S.resultados.map(r => {
    const jogos = (r.jogos || []).slice().sort((a, b) => toDate(a.inicio) - toDate(b.inicio));
    const res = r.resultados || {};
    const contam = jogos.filter(g => ["1", "X", "2"].includes(res[g.id]));
    const jogadores = Object.keys(r.escolhas || {}).filter(uid => S.perfis[uid]);
    const venc = (r.vencedores || []).filter(uid => S.perfis[uid]);
    const melhor = Math.max(0, ...jogadores.map(u => r.acertos?.[u] || 0));
    const melhores = jogadores.filter(u => (r.acertos?.[u] || 0) === melhor);
    const eu = S.user.uid;
    const aberto = S.abertos.has(r.id);
    const ordem = jogadores.slice().sort((a, b) => (r.acertos?.[b] || 0) - (r.acertos?.[a] || 0) || nomeDe(a).localeCompare(nomeDe(b), "pt"));
    const banner = venc.length
      ? `<div class="vencedores"><b>${venc.length === 1 ? "Vencedor" : "Vencedores"}:</b> ${venc.map(u => esc(nomeDe(u))).join(", ")}</div>`
      : `<div class="vencedores ninguem">Ninguém acertou em tudo.${jogadores.length ? ` O melhor foi ${melhor} em ${r.validos}: ${melhores.map(u => esc(nomeDe(u))).join(", ")}.` : ""}</div>`;
    const meuTxt = r.escolhas?.[eu] ? `<p class="nota" style="margin-top:10px">Acertaste ${r.acertos?.[eu] || 0} em ${r.validos}.</p>` : "";
    return `<section class="cartao">
      <div class="res-cab"><h3>Jornada ${r.numero}</h3><span class="nota">${jogadores.length} ${jogadores.length === 1 ? "boletim" : "boletins"}</span></div>
      ${banner}
      <ol class="lista-jogos">${jogos.map((g, i) => `<li><span class="num">${i + 1}</span><span>${esc(g.casa)} – ${esc(g.fora)}</span>
        ${res[g.id] === "A" ? `<span class="res anulado">Anulado</span>` : `<span class="res">${esc(res[g.id] || "?")}</span>`}</li>`).join("")}</ol>
      ${meuTxt}
      ${jogadores.length ? `<button class="link" style="margin-top:8px" data-acao="abrir-res" data-id="${r.id}" aria-expanded="${aberto}">${aberto ? "Esconder boletins" : "Ver o boletim de toda a gente"}</button>` : ""}
      ${aberto ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Jogador</th>${jogos.map((g, i) => `<th class="c">${i + 1}</th>`).join("")}<th class="c">Certos</th></tr></thead>
        <tbody>${ordem.map(u => `<tr class="${u === eu ? "eu" : ""}"><td>${esc(nomeDe(u))}</td>${jogos.map(g => {
          const p = r.escolhas[u]?.[g.id], real = res[g.id];
          const cls = !["1", "X", "2"].includes(real) ? "na" : (p === real ? "sim" : "nao");
          return `<td class="c"><span class="pk ${cls}">${esc(p || "–")}</span></td>`;
        }).join("")}<td class="c n">${r.acertos?.[u] || 0}/${r.validos}</td></tr>`).join("")}</tbody>
      </table></div>` : ""}
    </section>`;
  }).join("");
}

/* Classificação */
function ranking(lista, chave) {
  let pos = 0, ant = null;
  return lista.map((x, i) => { const v = chave(x); if (v !== ant) { pos = i + 1; ant = v; } return { ...x, pos }; });
}
function vistaClassificacao() {
  const est = {};
  for (const r of S.resultados) {
    for (const [uid, n] of Object.entries(r.acertos || {})) {
      const e = est[uid] ??= { uid, vit: 0, ac: 0, jog: 0, poss: 0 };
      e.ac += n; e.jog += 1; e.poss += r.validos || 0;
    }
    for (const uid of r.vencedores || []) (est[uid] ??= { uid, vit: 0, ac: 0, jog: 0, poss: 0 }).vit += 1;
  }
  const todos = Object.values(est).filter(e => S.perfis[e.uid]);
  if (!todos.length) return aviso("Classificação vazia", "A classificação começa a contar quando saírem os resultados da primeira jornada.");
  const eu = S.user.uid;
  const venc = ranking(todos.slice().sort((a, b) => b.vit - a.vit || b.ac - a.ac || nomeDe(a.uid).localeCompare(nomeDe(b.uid), "pt")), x => `${x.vit}|${x.ac}`);
  const cert = ranking(todos.slice().sort((a, b) => b.ac - a.ac || b.vit - a.vit || nomeDe(a.uid).localeCompare(nomeDe(b.uid), "pt")), x => `${x.ac}|${x.vit}`);
  const linha = (x, cols) => `<tr class="${x.uid === eu ? "eu" : ""}"><td class="pos">${x.pos === 1 ? `<span class="medalha">1.º</span>` : x.pos + ".º"}</td><td>${esc(nomeDe(x.uid))}</td>${cols}</tr>`;
  return `<div class="classif">
    <section class="cartao">
      <h3>Mais vencedores</h3><p class="nota">Jornadas ganhas (acertar em todos os jogos). Em caso de empate conta o total de acertos.</p>
      <div class="tabela-wrap"><table><thead><tr><th></th><th>Jogador</th><th class="c">Vitórias</th><th class="c">Acertos</th></tr></thead>
      <tbody>${venc.map(x => linha(x, `<td class="c n">${x.vit}</td><td class="c n">${x.ac}</td>`)).join("")}</tbody></table></div>
    </section>
    <section class="cartao">
      <h3>Mais certeiros</h3><p class="nota">Total de jogos acertados em todas as jornadas.</p>
      <div class="tabela-wrap"><table><thead><tr><th></th><th>Jogador</th><th class="c">Acertos</th><th class="c">Jorn.</th><th class="c">%</th></tr></thead>
      <tbody>${cert.map(x => linha(x, `<td class="c n">${x.ac}</td><td class="c n">${x.jog}</td><td class="c n">${x.poss ? Math.round(100 * x.ac / x.poss) : 0}</td>`)).join("")}</tbody></table></div>
    </section>
  </div>`;
}

/* Admin */
function vistaAdmin() {
  return `<section class="cartao admin-sec pilha">${adminJornadas()}</section>
    <section class="cartao admin-sec pilha">${adminJogadores()}</section>`;
}

function adminJornadas() {
  if (!S.jornadas.length) {
    const agora = new Date();
    const sugestao = CALENDARIO.find(c => {
      const toto = c.jogos.filter(g => g.casa !== CLUBE && g.fora !== CLUBE).map(g => g.inicio).sort();
      return prazoPadrao(new Date(toto[0])) > agora;
    })?.numero || 1;
    const de = S.importDe ?? sugestao;
    const n = CALENDARIO.filter(c => c.numero >= de).length;
    return `<div><p class="eyebrow">Passo 1</p><h2>Importar calendário</h2></div>
      <p class="nota">O calendário da Série A já está carregado (fonte: resultados.fpf.pt). O jogo do Realense fica sempre de fora.
      Cada jornada abre na segunda-feira e fecha sexta às 21:00, ou às 12:30 do dia do primeiro jogo se houver jogo antes disso. Podes mudar tudo depois.</p>
      <div class="campo"><label for="imp-de">Começar na jornada</label>
        <select id="imp-de" data-imp="1">${CALENDARIO.map(c => `<option value="${c.numero}" ${c.numero === de ? "selected" : ""}>Jornada ${c.numero} (${esc(fmtDia(new Date(c.jogos[0].inicio)))})</option>`).join("")}</select>
        <small>Vai criar ${n} ${n === 1 ? "jornada" : "jornadas"}.</small></div>
      <div class="acoes"><button class="btn" data-acao="importar" ${S.ocupado ? "disabled" : ""}>Importar calendário</button></div>`;
  }
  const agora = Date.now();
  const atual = jornadaAtual();
  const iAtual = Math.max(0, S.jornadas.findIndex(j => j.id === atual?.id));
  const visiveis = S.todasJ ? S.jornadas : S.jornadas.filter((j, i) => (i >= iAtual && i < iAtual + 4) || S.edit?.id === j.id);
  const lista = visiveis.map(j => {
    const est = estadoJornada(j, agora);
    const nBol = S.todosPalpites.filter(p => p.jornada === j.id).length;
    const aEditar = S.edit?.id === j.id;
    return `<div class="linha-j" ${j.id === atual?.id ? `style="background:var(--azul-claro);margin-inline:-16px;padding-inline:16px"` : ""}>
      <span class="jn">J${j.numero}</span>
      <div class="info"><span class="chip ${est}">${esc(ROT_ESTADO[est])}</span> ${nBol} ${nBol === 1 ? "boletim" : "boletins"}<br>
        Fecha ${esc(fmtDH(toDate(j.prazo)))}</div>
      <button class="btn mini sec" data-acao="editar" data-id="${j.id}">${aEditar ? "Fechar" : (est === "fechada" ? "Resultados" : "Editar")}</button>
    </div>${aEditar ? editorJornada() : ""}`;
  }).join("");
  const proxNum = (S.jornadas[S.jornadas.length - 1]?.numero || 0) + 1;
  return `<div class="cab-jornada"><div><p class="eyebrow">Admin</p><h2>Jornadas</h2></div>
      <button class="btn mini sec" data-acao="nova-jornada" data-n="${proxNum}">+ Nova jornada</button></div>
    <p class="nota">Para lançar resultados: abre a jornada, marca 1, X ou 2 em cada jogo (ou Anulado se foi adiado) e carrega em Publicar resultados.</p>
    <div>${S.edit && !S.jornadas.some(j => j.id === S.edit.id) ? editorJornada() : ""}${lista}</div>
    ${S.jornadas.length > visiveis.length || S.todasJ ? `<button class="link" data-acao="todas-j">${S.todasJ ? "Mostrar só as próximas" : `Mostrar todas as jornadas (${S.jornadas.length})`}</button>` : ""}`;
}

function editorJornada() {
  const e = S.edit;
  const opcoes = sel => [`<option value="">Escolher equipa</option>`, ...EQUIPAS.filter(t => t !== CLUBE).map(t => `<option ${t === sel ? "selected" : ""}>${esc(t)}</option>`)].join("");
  const boletins = S.todosPalpites.filter(p => p.jornada === e.id);
  const semBoletim = Object.keys(S.perfis).filter(u => !boletins.some(p => p.uid === u) && !S.bloqueados[u]);
  const prazoPassou = Date.now() >= new Date(e.prazo).getTime();
  const ativos = e.jogos.filter(g => e.resultados[g.id] !== "A");
  const completos = ativos.every(g => ["1", "X", "2"].includes(e.resultados[g.id]));
  const publicado = !!resMap()[e.id];
  const conf = S.confirmar === "apagar-j:" + e.id;
  return `<div class="editor" style="padding:6px 0 18px">
    <div class="dois">
      <div class="campo"><label for="ed-ab">Abre</label><input id="ed-ab" type="datetime-local" data-ed="abertura" value="${esc(e.abertura)}"></div>
      <div class="campo"><label for="ed-pr">Fecha (prazo)</label><input id="ed-pr" type="datetime-local" data-ed="prazo" value="${esc(e.prazo)}"></div>
    </div>
    <button class="link" data-acao="recalcular">Recalcular abertura e prazo pela regra</button>
    <div class="campo"><label for="ed-re">Jogo do Realense (fica de fora)</label><input id="ed-re" data-ed="realense" maxlength="80" value="${esc(e.realense)}"></div>
    ${e.jogos.map((g, i) => `<div class="ed-jogo">
      <div class="topo-j"><b>Jogo ${i + 1}</b><button class="link perigo" data-acao="tirar-jogo" data-g="${g.id}">Remover</button></div>
      <div class="dois">
        <div class="campo"><label for="ed-c-${g.id}">Casa</label><select id="ed-c-${g.id}" data-ed="casa" data-g="${g.id}">${opcoes(g.casa)}</select></div>
        <div class="campo"><label for="ed-f-${g.id}">Fora</label><select id="ed-f-${g.id}" data-ed="fora" data-g="${g.id}">${opcoes(g.fora)}</select></div>
      </div>
      <div class="campo"><label for="ed-i-${g.id}">Dia e hora</label><input id="ed-i-${g.id}" type="datetime-local" data-ed="inicio" data-g="${g.id}" value="${esc(g.inicio)}"></div>
      <div class="campo"><label>Resultado</label><div class="seg" role="group" aria-label="Resultado do jogo ${i + 1}">
        ${[["", "–"], ["1", "1"], ["X", "X"], ["2", "2"], ["A", "Anulado"]].map(([v, r]) =>
          `<button data-acao="res" data-g="${g.id}" data-v="${v}" aria-pressed="${(e.resultados[g.id] || "") === v}">${r}</button>`).join("")}
      </div></div>
    </div>`).join("")}
    <button class="link" data-acao="mais-jogo">+ Adicionar jogo</button>
    ${e.erro ? `<div class="erro-msg" role="alert">${esc(e.erro)}</div>` : ""}
    <div class="acoes">
      <button class="btn sec" data-acao="guardar-j" ${S.ocupado ? "disabled" : ""}>Guardar jornada</button>
      <button class="btn" data-acao="publicar" ${S.ocupado || !prazoPassou || !completos ? "disabled" : ""}>${publicado ? "Atualizar resultados" : "Publicar resultados"}</button>
    </div>
    ${!prazoPassou ? `<p class="nota">Só podes publicar resultados depois do prazo fechar.</p>` : (!completos ? `<p class="nota">Para publicar, marca o resultado de todos os jogos (ou Anulado).</p>` : "")}
    <div><p class="eyebrow">Boletins recebidos (${boletins.length})</p>
      ${boletins.length ? `<div class="tabela-wrap"><table><thead><tr><th>Jogador</th>${ativos.map((g, i) => `<th class="c">${i + 1}</th>`).join("")}</tr></thead>
        <tbody>${boletins.map(p => `<tr><td>${esc(nomeDe(p.uid) || "(apagado)")}</td>${ativos.map(g => `<td class="c"><span class="pk">${esc(p.escolhas?.[g.id] || "–")}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="nota">Ainda ninguém registou boletim.</p>`}
      ${semBoletim.length ? `<p class="nota" style="margin-top:8px">Sem boletim: ${semBoletim.map(u => esc(nomeDe(u))).join(", ")}</p>` : ""}
    </div>
    <div class="acoes" style="justify-content:flex-start">
      ${conf ? `<div class="confirmar">Apagar a Jornada ${e.numero} e todos os boletins dela?
          <button class="btn mini perigo" data-acao="apagar-j-sim">Apagar</button><button class="btn mini sec" data-acao="cancelar-conf">Manter</button></div>`
        : `<button class="link perigo" data-acao="apagar-j">Apagar esta jornada</button>`}
    </div>
  </div>`;
}

function adminJogadores() {
  const eu = S.user.uid;
  const ids = Object.keys(S.perfis).sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), "pt"));
  const apagados = Object.entries(S.bloqueados).filter(([u, b]) => b.apagado);
  const linhas = ids.map(u => {
    const bloq = S.bloqueados[u];
    const n = S.todosPalpites.filter(p => p.uid === u).length;
    const conf = S.confirmar === "apagar-u:" + u;
    return `<div class="jogador-adm">
      <div><div class="nm">${esc(nomeDe(u))} ${bloq ? `<span class="chip fechada">Bloqueado</span>` : ""}${u === S.adminUid ? ` <span class="chip concluida">Admin</span>` : ""}</div>
        <div class="em">${esc(S.privados[u]?.email || "")} · ${n} ${n === 1 ? "boletim" : "boletins"}</div></div>
      <div class="acoes">${u === eu ? "" : `
        ${bloq ? `<button class="btn mini sec" data-acao="desbloquear" data-u="${u}">Desbloquear</button>` : `<button class="btn mini sec" data-acao="bloquear" data-u="${u}">Bloquear</button>`}
        <button class="btn mini sec" data-acao="apagar-u" data-u="${u}">Apagar</button>`}</div>
      ${conf ? `<div class="confirmar">Apagar ${esc(nomeDe(u))}? Saem os boletins e o nome dele, e a conta fica sem acesso.
        <button class="btn mini perigo" data-acao="apagar-u-sim" data-u="${u}">Apagar</button><button class="btn mini sec" data-acao="cancelar-conf">Manter</button></div>` : ""}
    </div>`;
  }).join("");
  return `<div><p class="eyebrow">Admin</p><h2>Jogadores (${ids.length})</h2></div>
    <p class="nota">Bloquear impede a pessoa de registar boletins. Apagar tira o nome e os boletins e fecha-lhe o acesso.</p>
    <div>${linhas || `<p class="nota">Ainda ninguém criou conta.</p>`}</div>
    ${apagados.length ? `<div><p class="eyebrow" style="margin-top:8px">Contas apagadas</p>${apagados.map(([u]) => `<div class="jogador-adm">
      <div class="em">${esc(S.privados[u]?.email || "Conta sem email")}</div>
      <div class="acoes"><button class="btn mini sec" data-acao="desbloquear" data-u="${u}">Deixar voltar</button></div></div>`).join("")}</div>` : ""}`;
}

/* ---------- Ações ---------- */
function abrirEditor(j) {
  S.edit = {
    id: j.id, numero: j.numero,
    abertura: toLocalInput(toDate(j.abertura)), prazo: toLocalInput(toDate(j.prazo)),
    realense: j.realense || "",
    jogos: (j.jogos || []).map(g => ({ id: g.id, casa: g.casa, fora: g.fora, inicio: toLocalInput(toDate(g.inicio)) })),
    resultados: { ...(j.resultados || {}) }, erro: ""
  };
}

function validarEdit() {
  const e = S.edit;
  const ab = new Date(e.abertura), pr = new Date(e.prazo);
  if (isNaN(ab) || isNaN(pr)) return "Preenche o dia e a hora de abertura e do prazo.";
  if (pr <= ab) return "O prazo tem de ser depois da abertura.";
  if (!e.jogos.length) return "A jornada precisa de pelo menos um jogo.";
  for (const [i, g] of e.jogos.entries()) {
    if (!g.casa || !g.fora) return `Escolhe as duas equipas do jogo ${i + 1}.`;
    if (g.casa === g.fora) return `No jogo ${i + 1} a equipa da casa e a de fora são iguais.`;
    if (isNaN(new Date(g.inicio))) return `Preenche o dia e a hora do jogo ${i + 1}.`;
  }
  return "";
}

function dadosEdit() {
  const e = S.edit;
  const ids = new Set(e.jogos.map(g => g.id));
  return {
    numero: e.numero,
    abertura: Timestamp.fromDate(new Date(e.abertura)),
    prazo: Timestamp.fromDate(new Date(e.prazo)),
    realense: e.realense.trim(),
    jogos: e.jogos.map(g => ({ id: g.id, casa: g.casa, fora: g.fora, inicio: Timestamp.fromDate(new Date(g.inicio)) })),
    resultados: Object.fromEntries(Object.entries(e.resultados).filter(([g, v]) => ids.has(g) && v))
  };
}

async function guardarJornada() {
  const erro = validarEdit();
  S.edit.erro = erro;
  if (erro) { render(true); return false; }
  await setDoc(doc(db, "jornadas", S.edit.id), dadosEdit());
  return true;
}

async function publicarResultados() {
  if (!(await guardarJornada())) return;
  const e = S.edit, d = dadosEdit();
  const validos = d.jogos.filter(g => ["1", "X", "2"].includes(d.resultados[g.id]));
  const snap = await getDocs(query(collection(db, "palpites"), where("jornada", "==", e.id)));
  const escolhas = {}, acertos = {}, vencedores = [];
  snap.forEach(s => {
    const p = s.data();
    escolhas[p.uid] = p.escolhas || {};
    const n = validos.filter(g => p.escolhas?.[g.id] === d.resultados[g.id]).length;
    acertos[p.uid] = n;
    if (validos.length && n === validos.length) vencedores.push(p.uid);
  });
  await setDoc(doc(db, "resultados", e.id), {
    numero: d.numero, jogos: d.jogos, resultados: d.resultados,
    escolhas, acertos, validos: validos.length, vencedores, publicadoEm: serverTimestamp()
  });
  toast(vencedores.length ? `Resultados publicados. ${vencedores.length === 1 ? "Há 1 vencedor" : `Há ${vencedores.length} vencedores`}!` : "Resultados publicados. Ninguém acertou em tudo.");
}

async function correr(fn, ok) {
  S.ocupado = true; render(true);
  try { await fn(); if (ok) toast(ok); }
  catch (e) { console.error(e); toast(e?.code === "permission-denied" ? "Não tens permissão para isto." : "Não deu para guardar. Verifica a ligação e tenta outra vez."); }
  S.ocupado = false; render(true);
}

async function criarPerfil(nomeBruto) {
  const nome = limparNome(nomeBruto);
  if (nome.length < 2 || nome.length > 20 || !RE_NOME.test(nome)) {
    S.erroNome = "O nome tem de ter entre 2 e 20 letras ou números (pode ter espaços, pontos ou hífenes no meio).";
    return render(true);
  }
  const chave = nome.toLowerCase();
  try {
    const existe = await getDoc(doc(db, "nomes", chave));
    if (existe.exists()) { S.erroNome = `O nome "${nome}" já está a ser usado. Escolhe outro.`; return render(true); }
    const u = auth.currentUser;
    const b = writeBatch(db);
    b.set(doc(db, "nomes", chave), { uid: u.uid });
    b.set(doc(db, "perfis", u.uid), { nome, chave, criadoEm: serverTimestamp() });
    b.set(doc(db, "privado", u.uid), { email: u.email });
    await b.commit();
    S.erroNome = ""; S.f = {};
  } catch (e) {
    console.error(e);
    S.erroNome = e?.code === "permission-denied" ? `Não deu para usar o nome "${nome}". Experimenta outro.` : "Não deu para guardar o nome. Tenta outra vez.";
    render(true);
  }
}

document.addEventListener("submit", async ev => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === "f-nome") return criarPerfil(f.nome.value);
  if (f.id !== "f-entrar") return;
  const email = f.email.value.trim(), pass = f.pass?.value || "";
  S.f.email = email; if (f.nome) S.f.nome = f.nome.value;
  S.erroEntrar = ""; S.okEntrar = ""; S.aEntrar = true; render(true);
  try {
    if (S.modo === "entrar") await signInWithEmailAndPassword(auth, email, pass);
    else if (S.modo === "recuperar") {
      await sendPasswordResetEmail(auth, email);
      S.okEntrar = "Se houver uma conta com este email, vais receber uma mensagem para mudares a palavra-passe.";
    } else {
      const nome = limparNome(f.nome.value);
      if (nome.length < 2 || nome.length > 20 || !RE_NOME.test(nome)) throw { msg: "O nome tem de ter entre 2 e 20 letras ou números." };
      await createUserWithEmailAndPassword(auth, email, pass);
      await criarPerfil(nome);
    }
  } catch (e) { S.erroEntrar = e.msg || msgErroAuth(e); }
  S.aEntrar = false; render(true);
});

document.addEventListener("input", ev => {
  const t = ev.target;
  if (t.closest("#f-entrar") || t.closest("#f-nome")) { if (t.name === "email" || t.name === "nome") S.f[t.name] = t.value; return; }
  if (t.dataset.ed && S.edit) {
    if (t.dataset.g) { const g = S.edit.jogos.find(x => x.id === t.dataset.g); if (g) g[t.dataset.ed] = t.value; }
    else S.edit[t.dataset.ed] = t.value;
  }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.dataset.imp) { S.importDe = +t.value; render(true); return; }
  if (t.dataset.ed && S.edit) {
    if (t.dataset.g) { const g = S.edit.jogos.find(x => x.id === t.dataset.g); if (g) g[t.dataset.ed] = t.value; }
    else S.edit[t.dataset.ed] = t.value;
  }
});

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button[data-acao], button[data-tab], button[data-modo]");
  if (!t) return;
  if (t.dataset.modo) { S.modo = t.dataset.modo; S.erroEntrar = ""; S.okEntrar = ""; return render(true); }
  if (t.dataset.tab) {
    S.tab = t.dataset.tab; S.confirmar = null;
    try { localStorage.setItem("totoreal-tab", S.tab); } catch {}
    render(true); window.scrollTo(0, 0); return;
  }
  const a = t.dataset.acao;
  if (a === "sair") return signOut(auth);
  if (a === "ser-admin") return correr(() => setDoc(doc(db, "config", "admin"), { uid: S.user.uid }), "Agora és o administrador. Vê o separador Admin.");
  if (a === "marcar") {
    const r = S.rascunho[t.dataset.j] ??= {};
    r[t.dataset.g] = t.dataset.v;
    return render(true);
  }
  if (a === "guardar") {
    const j = S.jornadas.find(x => x.id === t.dataset.j);
    if (!j) return;
    const escolhas = {};
    for (const g of jogosAtivos(j)) escolhas[g.id] = escolhaEfetiva(j, g.id);
    S.aGuardar = true; render(true);
    try {
      await setDoc(doc(db, "palpites", `${j.id}_${S.user.uid}`), { uid: S.user.uid, jornada: j.id, escolhas, atualizadoEm: serverTimestamp() });
      delete S.rascunho[j.id];
      toast("Boletim registado. Boa sorte!");
    } catch (e) {
      console.error(e);
      toast(e?.code === "permission-denied" ? "Não deu para registar: o prazo desta jornada já fechou." : "Não deu para registar. Verifica a ligação e tenta outra vez.");
    }
    S.aGuardar = false; return render(true);
  }
  if (a === "todas-j") { S.todasJ = !S.todasJ; return render(true); }
  if (a === "abrir-res") { const id = t.dataset.id; S.abertos.has(id) ? S.abertos.delete(id) : S.abertos.add(id); return render(true); }

  // Admin
  if (!souAdmin()) return;
  if (a === "importar") {
    const de = S.importDe ?? +($("#imp-de")?.value || 1);
    return correr(async () => {
      const b = writeBatch(db);
      for (const j of gerarJornadas(de)) { const { id, ...d } = j; b.set(doc(db, "jornadas", id), d); }
      await b.commit();
    }, "Calendário importado.");
  }
  if (a === "editar") {
    const j = S.jornadas.find(x => x.id === t.dataset.id);
    if (S.edit?.id === j.id) S.edit = null; else abrirEditor(j);
    S.confirmar = null; return render(true);
  }
  if (a === "nova-jornada") {
    const n = +t.dataset.n;
    if (n > 99) return;
    const ini = new Date(); ini.setDate(ini.getDate() + ((6 - ini.getDay() + 7) % 7 || 7)); ini.setHours(15, 0, 0, 0);
    const prazo = prazoPadrao(ini), ab = aberturaPadrao(ini, null);
    S.edit = { id: jid(n), numero: n, abertura: toLocalInput(ab), prazo: toLocalInput(prazo), realense: "", jogos: [{ id: "g1", casa: "", fora: "", inicio: toLocalInput(ini) }], resultados: {}, erro: "" };
    return render(true);
  }
  if (!S.edit && !["bloquear", "desbloquear", "apagar-u", "apagar-u-sim", "cancelar-conf"].includes(a)) return;
  if (a === "res") { S.edit.resultados[t.dataset.g] = t.dataset.v; return render(true); }
  if (a === "mais-jogo") {
    const max = Math.max(0, ...S.edit.jogos.map(g => +g.id.slice(1)));
    const ult = S.edit.jogos[S.edit.jogos.length - 1];
    S.edit.jogos.push({ id: "g" + (max + 1), casa: "", fora: "", inicio: ult?.inicio || "" });
    return render(true);
  }
  if (a === "tirar-jogo") { S.edit.jogos = S.edit.jogos.filter(g => g.id !== t.dataset.g); delete S.edit.resultados[t.dataset.g]; return render(true); }
  if (a === "recalcular") {
    const inis = S.edit.jogos.map(g => new Date(g.inicio)).filter(d => !isNaN(d)).sort((x, y) => x - y);
    if (!inis.length) return toast("Preenche primeiro a data dos jogos.");
    const ant = S.jornadas.filter(j => j.numero < S.edit.numero).pop();
    S.edit.prazo = toLocalInput(prazoPadrao(inis[0]));
    S.edit.abertura = toLocalInput(aberturaPadrao(inis[0], ant ? toDate(ant.prazo) : null));
    return render(true);
  }
  if (a === "guardar-j") return correr(async () => { if (await guardarJornada()) toast("Jornada guardada."); });
  if (a === "publicar") return correr(publicarResultados);
  if (a === "apagar-j") { S.confirmar = "apagar-j:" + S.edit.id; return render(true); }
  if (a === "cancelar-conf") { S.confirmar = null; return render(true); }
  if (a === "apagar-j-sim") {
    const id = S.edit.id; S.confirmar = null;
    return correr(async () => {
      const b = writeBatch(db);
      b.delete(doc(db, "jornadas", id)); b.delete(doc(db, "resultados", id));
      (await getDocs(query(collection(db, "palpites"), where("jornada", "==", id)))).forEach(s => b.delete(s.ref));
      await b.commit(); S.edit = null;
    }, "Jornada apagada.");
  }
  const u = t.dataset.u;
  if (a === "bloquear") return correr(() => setDoc(doc(db, "bloqueados", u), { apagado: false, em: serverTimestamp() }), "Jogador bloqueado.");
  if (a === "desbloquear") return correr(() => deleteDoc(doc(db, "bloqueados", u)), "Acesso devolvido.");
  if (a === "apagar-u") { S.confirmar = "apagar-u:" + u; return render(true); }
  if (a === "apagar-u-sim") {
    S.confirmar = null;
    const p = S.perfis[u];
    return correr(async () => {
      const b = writeBatch(db);
      b.set(doc(db, "bloqueados", u), { apagado: true, em: serverTimestamp() });
      b.delete(doc(db, "perfis", u));
      if (p?.chave) b.delete(doc(db, "nomes", p.chave));
      (await getDocs(query(collection(db, "palpites"), where("uid", "==", u)))).forEach(s => b.delete(s.ref));
      await b.commit();
    }, "Jogador apagado.");
  }
});

render(true);
