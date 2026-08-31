import type { RoutineBlock } from "@/types";
import { timeToSeconds } from "@/lib/routine/schedule";

/** Próximo bloco de trabalho após o blockId informado. */
export function getNextWorkBlock(
  workBlocks: RoutineBlock[],
  blockId: string,
): RoutineBlock | null {
  const idx = workBlocks.findIndex((b) => b.id === blockId);
  if (idx < 0 || idx >= workBlocks.length - 1) return null;
  return workBlocks[idx + 1];
}

/** Bloco de trabalho que contém o instante atual (segundos do dia). */
export function getWorkBlockAt(
  workBlocks: RoutineBlock[],
  daySeconds: number,
): RoutineBlock | null {
  return (
    workBlocks.find((b) => {
      const start = timeToSeconds(b.start);
      const end = timeToSeconds(b.end);
      return daySeconds >= start && daySeconds < end;
    }) ?? null
  );
}

/**
 * Imenda = mesmo tipo de atividade no próximo bloco de trabalho
 * (ex.: Dev → descanso → Dev).
 * Divergente = muda a atividade (ex.: Dev → GCM).
 */
export function isSameActivityChain(
  current: RoutineBlock,
  next: RoutineBlock | null,
): boolean {
  if (!next) return false;
  return current.activity === next.activity;
}
