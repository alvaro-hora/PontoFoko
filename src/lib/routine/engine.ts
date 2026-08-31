import type {
  BlockStatus,
  DayOfWeek,
  RoutineBlock,
  RoutineSnapshot,
} from "@/types";
import { dateAtTime, getRoutineForDay, LATE_TOLERANCE_SECONDS, timeToSeconds } from "./schedule";
import { exactDaySeconds } from "@/lib/time/exact";

function findCurrentIndex(blocks: RoutineBlock[], nowSeconds: number): number {
  return blocks.findIndex((block) => {
    const start = timeToSeconds(block.start);
    const end = timeToSeconds(block.end);
    return nowSeconds >= start && nowSeconds < end;
  });
}

function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

function formatRemain(seconds: number): string {
  const abs = Math.max(0, Math.floor(seconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}min ${String(s).padStart(2, "0")}s`;
  }
  return `${m}min ${String(s).padStart(2, "0")}s`;
}

function buildMessage(params: {
  status: BlockStatus;
  currentBlock: RoutineBlock | null;
  nextBlock: RoutineBlock | null;
  lateBySeconds: number;
  secondsUntilNext: number | null;
}): string {
  const { status, currentBlock, nextBlock, lateBySeconds, secondsUntilNext } =
    params;

  switch (status) {
    case "before_day":
      return nextBlock
        ? `A rotina começa às ${nextBlock.start} com ${nextBlock.activity}.`
        : "Nenhuma atividade planejada para hoje.";
    case "finished_day":
      return "Rotina de hoje concluída.";
    case "empty_day":
      return "Nenhuma atividade planejada hoje. Monte a rotina em Ajustes.";
    case "break":
      return currentBlock
        ? `Descanso até ${currentBlock.end}.`
        : "Em descanso.";
    case "gap":
      return nextBlock
        ? `Pausa agora — próximo: ${nextBlock.activity} às ${nextBlock.start}.`
        : "Nada em andamento.";
    case "late":
    case "should_have_started":
      return currentBlock
        ? `Você já deveria ter começado ${currentBlock.activity}. Atraso de ${formatRemain(lateBySeconds)}.`
        : "Você está atrasado.";
    case "on_time":
    case "active":
      return currentBlock
        ? `${currentBlock.activity} (${currentBlock.start}–${currentBlock.end}).`
        : "Tudo certo com o horário.";
    case "upcoming":
      return nextBlock && secondsUntilNext != null
        ? `Em breve: ${nextBlock.activity} em ${formatRemain(secondsUntilNext)}.`
        : "Esperando o próximo horário.";
    default:
      return "Acompanhe sua rotina.";
  }
}

export function getRoutineSnapshot(now = new Date()): RoutineSnapshot {
  const dayOfWeek = now.getDay() as DayOfWeek;
  const routine = getRoutineForDay(dayOfWeek);
  const blocks = routine.blocks;
  const nowExact = exactDaySeconds(now);

  if (blocks.length === 0) {
    return {
      now,
      dayLabel: routine.label,
      currentBlock: null,
      nextBlock: null,
      previousBlock: null,
      status: "empty_day",
      secondsUntilNext: null,
      secondsIntoBlock: null,
      secondsRemainingInBlock: null,
      isLate: false,
      lateBySeconds: 0,
      isOnTime: false,
      isBreak: false,
      shouldHaveStarted: false,
      message: "Nenhuma atividade planejada hoje. Monte a rotina em Ajustes.",
    };
  }

  const firstStart = timeToSeconds(blocks[0].start);
  const lastEnd = timeToSeconds(blocks[blocks.length - 1].end);
  const currentIndex = findCurrentIndex(blocks, nowExact);

  if (nowExact < firstStart) {
    const nextBlock = blocks[0];
    const secondsUntilNext = secondsBetween(now, dateAtTime(now, nextBlock.start));
    return {
      now,
      dayLabel: routine.label,
      currentBlock: null,
      nextBlock,
      previousBlock: null,
      status: "before_day",
      secondsUntilNext,
      secondsIntoBlock: null,
      secondsRemainingInBlock: null,
      isLate: false,
      lateBySeconds: 0,
      isOnTime: false,
      isBreak: false,
      shouldHaveStarted: false,
      message: buildMessage({
        status: "before_day",
        currentBlock: null,
        nextBlock,
        lateBySeconds: 0,
        secondsUntilNext,
      }),
    };
  }

  if (nowExact >= lastEnd) {
    return {
      now,
      dayLabel: routine.label,
      currentBlock: null,
      nextBlock: null,
      previousBlock: blocks[blocks.length - 1],
      status: "finished_day",
      secondsUntilNext: null,
      secondsIntoBlock: null,
      secondsRemainingInBlock: null,
      isLate: false,
      lateBySeconds: 0,
      isOnTime: true,
      isBreak: false,
      shouldHaveStarted: false,
      message: buildMessage({
        status: "finished_day",
        currentBlock: null,
        nextBlock: null,
        lateBySeconds: 0,
        secondsUntilNext: null,
      }),
    };
  }

  if (currentIndex === -1) {
    const nextIndex = blocks.findIndex(
      (b) => timeToSeconds(b.start) > nowExact,
    );
    const nextBlock = nextIndex >= 0 ? blocks[nextIndex] : null;
    const previousBlock =
      nextIndex > 0
        ? blocks[nextIndex - 1]
        : nextIndex === -1
          ? blocks[blocks.length - 1]
          : null;
    const secondsUntilNext = nextBlock
      ? secondsBetween(now, dateAtTime(now, nextBlock.start))
      : null;

    return {
      now,
      dayLabel: routine.label,
      currentBlock: null,
      nextBlock,
      previousBlock,
      status: "gap",
      secondsUntilNext,
      secondsIntoBlock: null,
      secondsRemainingInBlock: null,
      isLate: false,
      lateBySeconds: 0,
      isOnTime: true,
      isBreak: false,
      shouldHaveStarted: false,
      message: buildMessage({
        status: "gap",
        currentBlock: null,
        nextBlock,
        lateBySeconds: 0,
        secondsUntilNext,
      }),
    };
  }

  const currentBlock = blocks[currentIndex];
  const nextBlock =
    currentIndex < blocks.length - 1 ? blocks[currentIndex + 1] : null;
  const previousBlock = currentIndex > 0 ? blocks[currentIndex - 1] : null;
  const blockStartAt = dateAtTime(now, currentBlock.start);
  const blockEndAt = dateAtTime(now, currentBlock.end);
  const secondsIntoBlock = secondsBetween(blockStartAt, now);
  const secondsRemainingInBlock = secondsBetween(now, blockEndAt);
  const secondsUntilNext = nextBlock
    ? secondsBetween(now, dateAtTime(now, nextBlock.start))
    : secondsRemainingInBlock;

  if (currentBlock.isBreak) {
    return {
      now,
      dayLabel: routine.label,
      currentBlock,
      nextBlock,
      previousBlock,
      status: "break",
      secondsUntilNext,
      secondsIntoBlock,
      secondsRemainingInBlock,
      isLate: false,
      lateBySeconds: 0,
      isOnTime: true,
      isBreak: true,
      shouldHaveStarted: false,
      message: buildMessage({
        status: "break",
        currentBlock,
        nextBlock,
        lateBySeconds: 0,
        secondsUntilNext,
      }),
    };
  }

  const lateBySeconds = secondsIntoBlock;
  const isLate = lateBySeconds > LATE_TOLERANCE_SECONDS;
  const shouldHaveStarted = secondsIntoBlock > 0;
  const status: BlockStatus = isLate
    ? "late"
    : shouldHaveStarted
      ? "should_have_started"
      : "on_time";

  return {
    now,
    dayLabel: routine.label,
    currentBlock,
    nextBlock,
    previousBlock,
    status,
    secondsUntilNext,
    secondsIntoBlock,
    secondsRemainingInBlock,
    isLate,
    lateBySeconds: isLate ? lateBySeconds : 0,
    isOnTime: !isLate,
    isBreak: false,
    shouldHaveStarted,
    message: buildMessage({
      status,
      currentBlock,
      nextBlock,
      lateBySeconds: isLate ? lateBySeconds : 0,
      secondsUntilNext,
    }),
  };
}

export function getBlockWindow(block: RoutineBlock, day: Date) {
  return {
    start: dateAtTime(day, block.start),
    end: dateAtTime(day, block.end),
  };
}
