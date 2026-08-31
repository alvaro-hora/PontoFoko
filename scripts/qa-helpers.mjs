export function createQaReporter() {
  const oks = [];
  const fails = [];

  function ok(name, detail = "") {
    oks.push(name);
    console.log(`  OK ${name}${detail ? ` — ${detail}` : ""}`);
  }

  function fail(name, detail) {
    fails.push({ name, detail: String(detail) });
    console.log(`  FAIL ${name} — ${detail}`);
  }

  function assert(cond, name, detail = "") {
    if (cond) ok(name, detail);
    else fail(name, detail || "assertion false");
  }

  return { oks, fails, ok, fail, assert };
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function hhmm(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60_000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function dow() {
  return new Date().getDay();
}

export function emptyWeekly() {
  const labels = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];
  return [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({
    dayOfWeek,
    label: labels[dayOfWeek],
    blocks: [],
  }));
}

export function printQaSummary(label, oks, fails) {
  console.log(`\n=== ${label} ===`);
  console.log(`OK: ${oks.length}  FALHAS: ${fails.length}`);
  if (fails.length) {
    for (const f of fails) console.log(` - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}
