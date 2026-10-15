import { chromium } from "playwright-core";
import fs from "fs"; import path from "path";
const NM = path.resolve("node_modules");
const SHOTS = path.resolve("shots");
const BASE = "http://127.0.0.1:5000/";
await fetch("http://127.0.0.1:8080/emulator/v1/projects/demo-totoreal/databases/(default)/documents", { method: "DELETE" });
await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-totoreal/accounts", { method: "DELETE" });

const fontFaces = [];
for (const [fam, pkg, ws] of [["Big Shoulders Display", "big-shoulders-display", [700, 800, 900]], ["IBM Plex Sans", "ibm-plex-sans", [400, 500, 600, 700]], ["IBM Plex Mono", "ibm-plex-mono", [500, 600]]])
  for (const w of ws) for (const sub of ["latin", "latin-ext"])
    fontFaces.push(`@font-face{font-family:"${fam}";font-weight:${w};font-display:swap;src:url(https://fonts.local/${pkg}/${pkg}-${sub}-${w}-normal.woff2) format("woff2");}`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
async function novo(nome, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "pt-PT", timezoneId: "Europe/Lisbon", ...opts });
  await ctx.route(/gstatic\.com\/firebasejs\/10\.14\.1\/(.+)$/, (r) => { const f = r.request().url().match(/firebasejs\/10\.14\.1\/(.+)$/)[1]; r.fulfill({ path: path.join(NM, "firebase", f), contentType: "text/javascript" }); });
  await ctx.route(/fonts\.googleapis\.com/, r => r.fulfill({ body: fontFaces.join("\n"), contentType: "text/css" }));
  await ctx.route(/fonts\.local\/([^/]+)\/(.+)$/, r => { const m = r.request().url().match(/fonts\.local\/([^/]+)\/(.+)$/); r.fulfill({ path: path.join(NM, "@fontsource", m[1], "files", m[2]) }); });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log(`[${nome}] ERRO JS:`, e.message));
  page.on("console", m => { if (m.type() === "error") console.log(`[${nome}] consola:`, m.text().slice(0, 300)); });
  await page.goto(BASE);
  return page;
}
const shot = (p, n, full = true) => p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: full });
const passo = m => console.log("·", m);
async function criarConta(p, nome, email) {
  await p.getByRole("button", { name: "Criar conta" }).click();
  await p.fill("#e-nome", nome); await p.fill("#e-email", email); await p.fill("#e-pass", "segredo1");
  await p.locator("#f-entrar button[type=submit]").click();
  await p.getByRole("tab", { name: "Boletim" }).waitFor();
}

// Papi
const papi = await novo("papi");
await p_wait(papi);
async function p_wait(p) { await p.locator("#f-entrar").waitFor(); }
await shot(papi, "01-entrar", false);
await criarConta(papi, "Papi", "papi@teste.pt");
passo("papi criou conta");
await papi.getByRole("button", { name: "Ficar como administrador" }).click();
await papi.locator(".quem button", { hasText: "Admin" }).click();
await papi.getByRole("button", { name: "Importar calendário" }).waitFor();
console.log("  sugestão de início:", await papi.locator("#imp-de").inputValue());
await papi.selectOption("#imp-de", "2");
await shot(papi, "02-admin-importar", false);
await papi.getByRole("button", { name: "Importar calendário" }).click();
await papi.locator(".linha-j").first().waitFor();
console.log("  jornadas criadas:", await papi.locator(".linha-j").count());
const j2info = await papi.locator(".linha-j").first().innerText(); console.log("  primeira:", j2info.replace(/\n/g, " | "));

// Abrir a J2 já (para testar), mudando a abertura para ontem
await papi.locator(".linha-j").first().getByRole("button").click();
const ontem = new Date(Date.now() - 86400e3); const pad = n => String(n).padStart(2, "0");
const li = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
console.log("  prazo J2 importado:", await papi.locator("#ed-pr").inputValue(), " abertura:", await papi.locator("#ed-ab").inputValue());
await papi.fill("#ed-ab", li(ontem));
await papi.getByRole("button", { name: "Guardar jornada" }).click();
await papi.waitForTimeout(800);
await papi.getByRole("tab", { name: "Boletim" }).click();
await papi.locator(".bol-linha").first().waitFor();
console.log("  estado boletim:", await papi.locator(".cab-jornada .eyebrow").innerText(), "| jogos:", await papi.locator(".bol-linha").count());
await shot(papi, "03-boletim-vazio", false);
const escolhasPapi = ["1", "X", "2", "1", "1", "2"];
const linhas = papi.locator(".bol-linha");
for (let i = 0; i < await linhas.count(); i++) await linhas.nth(i).getByRole("button", { name: escolhasPapi[i % 6], exact: true }).click();
console.log("  barra:", await papi.locator(".barra-guardar .estado").innerText());
await shot(papi, "04-boletim-preenchido", false);
await papi.getByRole("button", { name: "Registar boletim" }).click();
await papi.getByRole("button", { name: "Registado" }).waitFor();
console.log("  depois de registar:", await papi.locator(".barra-guardar .estado").innerText());

// Bruno e Rui
const bruno = await novo("bruno"); await p_wait(bruno);
await criarConta(bruno, "Bruno", "bruno@teste.pt");
const l2 = bruno.locator(".bol-linha");
await l2.first().waitFor();
for (let i = 0; i < await l2.count(); i++) await l2.nth(i).getByRole("button", { name: "1", exact: true }).click();
await bruno.getByRole("button", { name: "Registar boletim" }).click();
await bruno.getByRole("button", { name: "Registado" }).waitFor();
passo("bruno registou o boletim 1");
// Segundo boletim: começa como cópia do 1, que não se pode registar igual
await bruno.getByRole("button", { name: "+ Novo boletim" }).click();
await bruno.getByRole("button", { name: "boletim 1", exact: true }).click();
console.log("  cópia igual:", await bruno.locator(".barra-guardar .estado").innerText(), "| botão ativo:", await bruno.locator(".barra-guardar .btn").isEnabled());
await l2.nth(1).getByRole("button", { name: "X", exact: true }).click();
await bruno.getByRole("button", { name: "Registar boletim 2" }).click();
await bruno.getByRole("button", { name: "Registado" }).waitFor();
passo("bruno registou o boletim 2");
// Terceiro boletim, depois apagado
await bruno.getByRole("button", { name: "+ Novo boletim" }).click();
for (let i = 0; i < await l2.count(); i++) await l2.nth(i).getByRole("button", { name: "2", exact: true }).click();
await bruno.getByRole("button", { name: "Registar boletim 3" }).click();
await bruno.getByRole("button", { name: "Registado" }).waitFor();
console.log("  separadores com 3 boletins:", (await bruno.locator(".bols").innerText()).replace(/\n/g, " | "));
await shot(bruno, "04b-bruno-tres-boletins", false);
await bruno.getByRole("button", { name: "Apagar o boletim 3" }).click();
await bruno.locator(".bol-pe .confirmar").getByRole("button", { name: "Apagar", exact: true }).click();
await bruno.waitForTimeout(800);
console.log("  depois de apagar:", (await bruno.locator(".bols").innerText()).replace(/\n/g, " | "));
// Alterar o boletim 1 mais tarde, para aparecer a hora da alteração
await bruno.waitForTimeout(1500);
await bruno.getByRole("button", { name: "Boletim 1", exact: true }).click();
await l2.nth(5).getByRole("button", { name: "X", exact: true }).click();
await bruno.getByRole("button", { name: "Registar alterações" }).click();
await bruno.getByRole("button", { name: "Registado" }).waitFor();
passo("bruno alterou o boletim 1");
const rui = await novo("rui"); await p_wait(rui);
await criarConta(rui, "Rui", "rui@teste.pt");
passo("rui criou conta");
// Boletim no formato antigo (como os que já existiam antes de haver vários boletins)
const H = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const BASE_FS = "http://127.0.0.1:8080/v1/projects/demo-totoreal/databases/(default)/documents";
let ruiUid;
for (let i = 0; i < 20 && !ruiUid; i++) {
  const perfisFS = await (await fetch(`${BASE_FS}/perfis`, { headers: H })).json();
  ruiUid = perfisFS.documents?.find(d => d.fields.nome.stringValue === "Rui")?.name.split("/").pop();
  if (!ruiUid) await rui.waitForTimeout(250);
}
const sv = v => ({ stringValue: v });
await fetch(`${BASE_FS}/palpites?documentId=J02_${ruiUid}`, { method: "POST", headers: H, body: JSON.stringify({ fields: {
  uid: sv(ruiUid), jornada: sv("J02"), atualizadoEm: { timestampValue: new Date().toISOString() },
  escolhas: { mapValue: { fields: { g1: sv("1"), g2: sv("X"), g3: sv("2"), g4: sv("1"), g5: sv("2"), g6: sv("2") } } } } }) });
const l3 = rui.locator(".bol-linha");
await rui.getByRole("button", { name: "Boletim 1", exact: true }).waitFor();
await l3.nth(5).getByRole("button", { name: "1", exact: true }).click();
await rui.getByRole("button", { name: "Registar alterações" }).click();
await rui.getByRole("button", { name: "Registado" }).waitFor();
passo("rui alterou um boletim antigo");
// nome repetido
const dup = await novo("dup"); await p_wait(dup);
await dup.getByRole("button", { name: "Criar conta" }).click();
await dup.fill("#e-nome", "bruno"); await dup.fill("#e-email", "outro@teste.pt"); await dup.fill("#e-pass", "segredo1");
await dup.locator("#f-entrar button[type=submit]").click();
await dup.locator(".erro-msg").waitFor();
console.log("  nome repetido:", await dup.locator(".erro-msg").innerText());

// Papi fecha a jornada (prazo no passado), mete resultados e publica
await papi.locator(".quem button", { hasText: "Admin" }).click();
if (!(await papi.locator("#ed-pr").count())) await papi.locator(".linha-j").first().getByRole("button").click();
await papi.fill("#ed-pr", li(new Date(Date.now() - 60e3)));
await papi.getByRole("button", { name: "Guardar jornada" }).click();
await papi.waitForTimeout(800);
const reais = ["1", "X", "2", "1", "1", "A"]; // último anulado
const eds = papi.locator(".ed-jogo");
for (let i = 0; i < await eds.count(); i++) await eds.nth(i).getByRole("button", { name: reais[i] === "A" ? "Anulado" : reais[i], exact: true }).click();
await shot(papi, "05-admin-resultados");
console.log("  admin vê:", (await papi.locator(".editor table").innerText()).replace(/\n/g, " | "));
await papi.getByRole("button", { name: "Publicar resultados" }).click();
await papi.locator("#toast").waitFor({ state: "visible" });
console.log("  toast:", await papi.locator("#toast").innerText());
await papi.getByRole("tab", { name: "Resultados" }).click();
await papi.getByRole("button", { name: "Ver o boletim de toda a gente" }).click();
console.log("  resultados:", (await papi.locator(".vencedores").innerText()));
console.log("  tabela:", (await papi.locator(".tabela-wrap table").innerText()).replace(/\n/g, " | "));
await shot(papi, "06-resultados");
await papi.getByRole("tab", { name: "Classificação" }).click();
await shot(papi, "07-classificacao");
console.log("  classificação:", (await papi.locator("table").first().innerText()).replace(/\n/g, " | "));

// Bruno não pode alterar depois do prazo; vê os resultados
await bruno.reload(); await bruno.getByRole("tab", { name: "Boletim" }).waitFor();
console.log("  bruno boletim agora:", (await bruno.locator(".cab-jornada").innerText()).replace(/\n/g, " | "));
await bruno.getByRole("tab", { name: "Resultados" }).click();
console.log("  bruno vê:", await bruno.locator(".cartao .nota").nth(1).innerText());
await shot(bruno, "08b-bruno-resultados", false);
await bruno.getByRole("tab", { name: "Boletim" }).click();
await shot(bruno, "08-bruno-boletim", false);

// Bloquear o Rui
await papi.locator(".quem button", { hasText: "Admin" }).click();
const linhaRui = papi.locator(".jogador-adm", { hasText: "Rui" });
await linhaRui.getByRole("button", { name: "Bloquear" }).click();
await papi.waitForTimeout(800);
await rui.waitForTimeout(500);
console.log("  rui vê:", (await rui.locator(".aviso h2").innerText()));
await shot(papi, "09-admin-jogadores");
// Apagar o Bruno
await papi.locator(".jogador-adm", { hasText: "Bruno" }).getByRole("button", { name: "Apagar" }).click();
await papi.locator(".jogador-adm .confirmar").getByRole("button", { name: "Apagar", exact: true }).click();
await papi.waitForTimeout(1000);
console.log("  bruno vê:", (await bruno.locator(".aviso h2").innerText()));
console.log("  jogadores no admin:", await papi.locator(".jogador-adm .nm").allInnerTexts());

// Modo escuro
const escuro = await novo("escuro", { colorScheme: "dark" }); await p_wait(escuro);
await escuro.fill("#e-email", "papi@teste.pt"); await escuro.fill("#e-pass", "segredo1");
await escuro.locator("#f-entrar button[type=submit]").click();
await escuro.getByRole("tab", { name: "Boletim" }).waitFor();
await escuro.waitForTimeout(800);
await shot(escuro, "10-escuro-boletim", false);
// Largura pequena sem scroll horizontal
const larg = await novo("small", { viewport: { width: 320, height: 700 } }); await p_wait(larg);
await larg.fill("#e-email", "papi@teste.pt"); await larg.fill("#e-pass", "segredo1");
await larg.locator("#f-entrar button[type=submit]").click();
await larg.getByRole("tab", { name: "Boletim" }).waitFor(); await larg.waitForTimeout(600);
console.log("  scroll horizontal a 320px:", await larg.evaluate(() => document.documentElement.scrollWidth > innerWidth));
await shot(larg, "11-320px", false);
await browser.close();
console.log("FIM");
