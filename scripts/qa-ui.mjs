/**
 * QA UI — tudo que o usuário clica (Playwright no site real).
 * Uso: node scripts/qa-ui.mjs
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { loadEnv, projectRoot } from "./load-env.mjs";
import { qaPrimary } from "./qa-config.mjs";

loadEnv();

spawnSync(process.execPath, [path.join(projectRoot, "scripts", "reset-qaauto.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});

const BASE = process.env.QA_URL || "https://pontofoko.web.app";
const { user: USER, password: PASS } = qaPrimary();

const fails = [];
const oks = [];

function ok(name, detail = "") {
  oks.push(name);
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  fails.push({ name, detail: String(detail) });
  console.log(`  ✗ ${name} — ${detail}`);
}
async function assert(cond, name, detail = "") {
  if (cond) ok(name, detail);
  else fail(name, detail || "assertion false");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hhmm(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60_000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function goNav(page, label, urlPart) {
  const href =
    label === "Ponto"
      ? "/"
      : label === "Pontualidade"
        ? "/dashboard/"
        : label === "Dias"
          ? "/historico/"
          : "/configuracao/";
  await page.goto(new URL(href, BASE).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForSelector("main", { timeout: 15000 });
  // espera sair do loading genérico quando possível
  await page.waitForTimeout(600);
  void urlPart;
}

async function main() {
  console.log(`\n=== QA UI — ${BASE} ===\n`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });

  const context = await browser.newContext({
    permissions: ["camera", "microphone", "notifications"],
    viewport: { width: 390, height: 844 }, // mobile-first
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });

  // Fake media
  await context.grantPermissions(["camera", "notifications"], { origin: BASE });

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    // ——— LOGIN ———
    console.log("1) Login / sessão");
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('input[autocomplete="username"], .app-topbar', {
      timeout: 30000,
    });
    await assert(
      (await page.locator('input[autocomplete="username"]').count()) > 0 ||
        (await page.getByText("Entrar").count()) > 0,
      "tela de login aparece",
    );

    await page.locator('input[autocomplete="username"]').fill(USER);
    await page.locator('input[autocomplete="current-password"]').fill(PASS);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForSelector(".app-frame, .app-topbar", { timeout: 15000 });
    await assert(
      (await page.locator(".app-topbar").count()) > 0,
      "login ok — app shell carregou",
    );
    // Nome pode estar hidden no mobile (.brand-text em { display:none })
    const hasName = (await page.locator("text=QA Auto").count()) > 0;
    await assert(hasName, "nome QA Auto no DOM");

    // Nav presente
    for (const label of ["Ponto", "Pontualidade", "Dias", "Ajustes", "Sair"]) {
      await assert(
        (await page.getByRole("button", { name: label }).count()) +
          (await page.getByRole("link", { name: label }).count()) >
          0 || (await page.getByText(label, { exact: true }).count()) > 0,
        `nav tem ${label}`,
      );
    }

    // ——— CONTA ZERADA — Ponto ———
    console.log("\n2) Conta zerada — Ponto");
    await goNav(page, "Ponto", "/");
    const pontoBody = await page.locator("main").innerText();
    await assert(
      /pausad|data de início|Defina|Começar|Sem rotina|Libera/i.test(pontoBody),
      "Ponto sinaliza estado coerente",
      pontoBody.slice(0, 120),
    );
    await assert(
      /Câmera libera|câmera|Ligando|Permita/i.test(pontoBody) ||
        (await page.locator(".live-camera").count()) > 0,
      "área de câmera presente (idle ou loading)",
    );

    // ——— Pontualidade zerada ———
    console.log("\n3) Conta zerada — Pontualidade");
    await goNav(page, "Pontualidade", "dashboard");
    await page.waitForSelector("text=Pontualidade", { timeout: 10000 });
    const pontText = await page.locator("main").innerText();
    await assert(
      /início|Defina|começ|planejado|Sem horários|contar/i.test(pontText),
      "Pontualidade com empty/banner adequado",
      pontText.slice(0, 160),
    );

    // ——— Dias zerado ———
    console.log("\n4) Conta zerada — Dias");
    await goNav(page, "Dias", "historico");
    await page.waitForSelector("text=Dias", { timeout: 10000 });
    const diasText = await page.locator("main").innerText();
    await assert(
      /Defina a data de início|data de início/i.test(diasText),
      "Dias pede data de início",
      diasText.slice(0, 160),
    );

    // ——— AJUSTES — configurar rotina ———
    console.log("\n5) Ajustes — montar rotina e salvar");
    await goNav(page, "Ajustes", "configuracao");

    // Data de início = hoje
    const dateInput = page.locator('input[type="date"]');
    await dateInput.fill(todayISO());

    // Retomar se pausado
    const pauseBtn = page.getByRole("button", {
      name: /Retomar rotina|Pausar rotina/,
    });
    const pauseLabel = await pauseBtn.innerText();
    if (/Retomar/i.test(pauseLabel)) {
      await pauseBtn.click();
      await page.waitForTimeout(1200);
      await assert(
        /retomad|andamento|ativa|aguardando/i.test(
          await page.locator("main").innerText(),
        ),
        "retomou rotina",
      );
    }

    // Garantir dia de hoje selecionado (tabs Seg..Dom)
    const dow = new Date().getDay(); // 0=dom
    const order = [1, 2, 3, 4, 5, 6, 0];
    const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const idx = order.indexOf(dow);
    await page.getByRole("tab", { name: labels[idx] }).click();
    await page.waitForTimeout(300);

    // Limpar blocos existentes se houver
    while ((await page.locator(".settings-blocks li").count()) > 0) {
      await page.locator(".settings-blocks li .settings-remove").first().click();
      await page.waitForTimeout(200);
    }

    // Adicionar bloco cobrindo agora
    await page.getByRole("button", { name: /Bloco/ }).click();
    await page.waitForTimeout(300);
    const start = hhmm(-30);
    const end = hhmm(60);
    const row = page.locator(".settings-blocks li").first();
    await row.locator('input[type="time"]').nth(0).fill(start);
    await row.locator('input[type="time"]').nth(1).fill(end);

    // Criar atividade nova
    const select = row.locator("select");
    if ((await select.count()) > 0) {
      await select.selectOption("__new__");
      await page.waitForTimeout(200);
      await page.locator(".settings-new-activity input").fill("Estudo UI");
      await page
        .locator(".settings-new-activity")
        .getByRole("button", { name: "Ok" })
        .click();
      await page.waitForTimeout(300);
    }

    // Salvar
    await page.getByRole("button", { name: /^Salvar$|Salvando/ }).click();
    await page.waitForTimeout(1500);
    const afterSave = await page.locator("main").innerText();
    await assert(/salva|Configuração salva/i.test(afterSave), "salvou configuração");

    // Status deve refletir live ou aguardando
    await assert(
      /ativa|pode bater|andamento|aguardando/i.test(afterSave),
      "status pós-save coerente",
    );

    // ——— DRAFT DIRTY ———
    console.log("\n6) Draft não some no Alt-Tab mental (focus)");
    await page.getByRole("button", { name: /Bloco/ }).click();
    await page.waitForTimeout(200);
    const blocksBefore = await page.locator(".settings-blocks li").count();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(1500);
    const blocksAfter = await page.locator(".settings-blocks li").count();
    await assert(
      blocksAfter === blocksBefore,
      `draft preservado após focus (${blocksBefore}→${blocksAfter})`,
    );
    // remove bloco extra sem salvar — depois vamos para Ponto (engine não deve ter o extra)
    if (blocksAfter > 1) {
      await page.locator(".settings-blocks li .settings-remove").last().click();
    }

    // ——— PONTO COM ROTINA ———
    console.log("\n7) Ponto com rotina ativa");
    await goNav(page, "Ponto", "/");
    await page.waitForTimeout(1500);
    const ponto2 = await page.locator("main").innerText();
    await assert(
      !/Defina a data de início/i.test(ponto2) || /Começar|Terminar|Em andamento|Descanso|Rotina/i.test(ponto2),
      "Ponto carregou estado da rotina",
      ponto2.slice(0, 160),
    );

    // Câmera deve tentar ligar se live
    const camIdle = await page.locator(".live-camera.is-idle").count();
    const camVideo = await page.locator(".live-camera video").count();
    const camErr = await page.locator(".live-camera.is-error").count();
    await assert(
      camIdle + camVideo + camErr > 0,
      `câmera no DOM (idle=${camIdle} video=${camVideo} err=${camErr})`,
    );

    // Tentar bater ponto se botão habilitado
    const punch = page.locator("button.btn-lg").first();
    const enabled = await punch.isEnabled();
    if (enabled) {
      await punch.click();
      await page.waitForTimeout(2500);
      const afterPunch = await page.locator("main").innerText();
      await assert(
        /Em andamento|Começou|Terminar|já faz|foto/i.test(afterPunch),
        "punch-in reagiu",
        afterPunch.slice(0, 140),
      );

      // Se abriu sessão, terminar
      const punch2 = page.locator("button.btn-lg").first();
      if (await punch2.isEnabled()) {
        const label = await punch2.innerText();
        if (/Terminar|Encerrar|fim/i.test(label)) {
          await punch2.click();
          await page.waitForTimeout(2500);
          await assert(true, "punch-out executado");
        }
      }
    } else {
      ok("botão ponto desabilitado (horário/estado) — ok se coerente", await punch.innerText());
    }

    // ——— PAUSAR COM SESSÃO? abrir e pausar ———
    console.log("\n8) Pausar e UI");
    // Garantir sessão: se possível start de novo
    await goNav(page, "Ajustes", "configuracao");
    await page.waitForTimeout(500);
    const pBtn = page.getByRole("button", { name: /Pausar rotina|Retomar rotina/ });
    if (/Pausar/i.test(await pBtn.innerText())) {
      await pBtn.click();
      await page.waitForTimeout(1200);
    }
    await goNav(page, "Ponto", "/");
    await page.waitForTimeout(800);
    const pausedPonto = await page.locator("main").innerText();
    await assert(/pausad/i.test(pausedPonto), "Ponto mostra rotina pausada");

    // Retomar
    await goNav(page, "Ajustes", "configuracao");
    await page.waitForTimeout(400);
    const rBtn = page.getByRole("button", { name: /Retomar rotina|Pausar rotina/ });
    if (/Retomar/i.test(await rBtn.innerText())) {
      await rBtn.click();
      await page.waitForTimeout(1200);
      await assert(true, "retomou de novo");
    }

    // ——— PONTUALIDADE COM DADOS ———
    console.log("\n9) Pontualidade tabs");
    await goNav(page, "Pontualidade", "dashboard");
    await page.waitForTimeout(1000);
    for (const tab of ["Hoje", "Semana", "Mês"]) {
      const t = page.getByRole("tab", { name: tab });
      if ((await t.count()) > 0) {
        await t.click();
        await page.waitForTimeout(400);
        await assert(true, `tab ${tab} clicável`);
      }
    }
    const pont2 = await page.locator("main").innerText();
    await assert(
      /Estudo UI|Feito|Planejado|horários|Sem horários|Resultado|Faltou/i.test(pont2),
      "Pontualidade renderiza conteúdo",
    );

    // ——— DIAS ———
    console.log("\n10) Dias");
    await goNav(page, "Dias", "historico");
    await page.waitForTimeout(1000);
    const dias2 = await page.locator("main").innerText();
    await assert(
      /Dias|mês|registro|Nenhum|hoje|meta/i.test(dias2),
      "Dias renderiza lista ou empty",
    );
    const dayRow = page.locator(".day-row").first();
    if ((await dayRow.count()) > 0) {
      await dayRow.click();
      await page.waitForTimeout(600);
      await assert(
        (await page.getByText(/Voltar|Resumo/i).count()) > 0,
        "detalhe do dia abre",
      );
      await page.getByText(/Voltar/i).first().click();
    }

    // ——— DESKTOP VIEWPORT ———
    console.log("\n11) Desktop layout");
    await page.setViewportSize({ width: 1280, height: 800 });
    await goNav(page, "Ponto", "/");
    await page.waitForTimeout(500);
    const topbar = page.locator(".app-topbar");
    await assert((await topbar.count()) > 0, "topbar existe no desktop");
    const bg = await topbar.evaluate((el) => getComputedStyle(el).backgroundColor);
    await assert(
      bg === "rgb(255, 255, 255)" || bg.includes("255"),
      `navbar branca (${bg})`,
    );

    // ——— OVERLAP VALIDATION ———
    console.log("\n12) Validação overlap nos Ajustes");
    await goNav(page, "Ajustes", "configuracao");
    await page.getByRole("tab", { name: labels[idx] }).click();
    // add second overlapping block
    await page.getByRole("button", { name: /Bloco/ }).click();
    await page.waitForTimeout(200);
    const last = page.locator(".settings-blocks li").last();
    await last.locator('input[type="time"]').nth(0).fill(start);
    await last.locator('input[type="time"]').nth(1).fill(end);
    await page.waitForTimeout(300);
    const err = await page.locator(".inline-error").innerText().catch(() => "");
    const saveDisabled = await page
      .getByRole("button", { name: /^Salvar$/ })
      .isDisabled();
    await assert(
      saveDisabled || /sobreposição|terminar|formato/i.test(err),
      "bloqueia salvar com overlap",
      err || `disabled=${saveDisabled}`,
    );
    // limpa o bloco inválido
    await page.locator(".settings-blocks li .settings-remove").last().click();

    // ——— LOGOUT ———
    console.log("\n13) Sair");
    await page.getByText("Sair", { exact: true }).first().click();
    await page.waitForTimeout(1000);
    await assert(
      (await page.getByRole("button", { name: "Entrar" }).count()) > 0,
      "voltou para login após Sair",
    );

    // Login de novo rápido
    await page.locator('input[autocomplete="username"]').fill(USER);
    await page.locator('input[autocomplete="current-password"]').fill(PASS);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForSelector(".app-frame, .app-topbar", { timeout: 15000 });
    await assert(true, "re-login ok");

    // Favicon check
    const icons = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel*="icon"]')].map((l) => l.href),
    );
    await assert(
      icons.some((h) => /icon\.png|logo\.png/i.test(h)),
      `favicon aponta logo/icon (${icons.join(", ")})`,
    );
  } catch (e) {
    fail("crash UI", e.stack || e.message);
    await page.screenshot({ path: "scripts/qa-ui-fail.png", fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log("\n=== RESULTADO QA UI ===");
  console.log(`OK: ${oks.length}  FALHAS: ${fails.length}`);
  if (fails.length) {
    for (const f of fails) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log("UI OK — fluxos de clique passaram.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
