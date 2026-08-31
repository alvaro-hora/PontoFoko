"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useAuth, useRoutine } from "@/components/providers";
import {
  BREAK_ACTIVITY,
  createEmptyWeeklyRoutine,
  DAY_ORDER,
  formatDuration,
  isBreakActivity,
  newBlockId,
  normalizeActivities,
  plannedSecondsForBlocks,
  sortBlocks,
  timeToSeconds,
  validateDayBlocks,
  DAY_LABELS,
} from "@/lib/routine/schedule";
import { renameUserActivity } from "@/lib/supabase/sessions";
import type { DayOfWeek, DayRoutine, RoutineBlock } from "@/types";

export function SettingsPanel() {
  const { user, updateProfile, live } = useAuth();
  const { weekly, activities, ready, applyLocal } = useRoutine();
  const [draft, setDraft] = useState<DayRoutine[]>(weekly);
  const [activityList, setActivityList] = useState<string[]>(activities);
  const [startDate, setStartDate] = useState(user?.start_date ?? "");
  const [paused, setPaused] = useState(Boolean(user?.paused));
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingForBlock, setCreatingForBlock] = useState<string | null>(null);
  const [newActivityName, setNewActivityName] = useState("");
  const [renamingActivity, setRenamingActivity] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!ready || !user || dirty) return;
    setDraft(weekly);
    setActivityList(normalizeActivities([...activities, BREAK_ACTIVITY]));
    setStartDate(user.start_date ?? "");
    setPaused(Boolean(user.paused));
  }, [ready, weekly, activities, user, dirty]);

  const day = draft.find((d) => d.dayOfWeek === selectedDay) ?? {
    dayOfWeek: selectedDay,
    label: "",
    blocks: [],
  };

  const dayError = useMemo(() => validateDayBlocks(day.blocks), [day.blocks]);
  const anyDayError = useMemo(() => {
    for (const d of draft) {
      const err = validateDayBlocks(d.blocks);
      if (err) return `${d.label}: ${err}`;
    }
    return null;
  }, [draft]);
  const workSeconds = plannedSecondsForBlocks(day.blocks);

  const updateDayBlocks = (blocks: RoutineBlock[]) => {
    const next = draft.map((d) =>
      d.dayOfWeek === selectedDay
        ? { ...d, blocks: sortBlocks(blocks) }
        : d,
    );
    setDraft(next);
    setDirty(true);
    setMessage(null);
    setError(null);
  };

  const patchBlock = (id: string, patch: Partial<RoutineBlock>) => {
    updateDayBlocks(
      day.blocks.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b, ...patch };
        if (patch.activity != null) {
          next.isBreak = isBreakActivity(patch.activity);
        }
        return next;
      }),
    );
  };

  const addBlock = () => {
    const last = day.blocks[day.blocks.length - 1];
    const start = last?.end ?? "09:00";
    const startSec = timeToSeconds(start);
    const endSec = Math.min(startSec + 60 * 60, 23 * 3600 + 59 * 60);
    const endH = String(Math.floor(endSec / 3600)).padStart(2, "0");
    const endM = String(Math.floor((endSec % 3600) / 60)).padStart(2, "0");
    const defaultActivity =
      activityList.find((a) => !isBreakActivity(a)) ?? BREAK_ACTIVITY;

    updateDayBlocks([
      ...day.blocks,
      {
        id: newBlockId(`d${selectedDay}`),
        start,
        end: `${endH}:${endM}`,
        activity: defaultActivity,
        isBreak: isBreakActivity(defaultActivity),
      },
    ]);
  };

  const removeBlock = (id: string) => {
    updateDayBlocks(day.blocks.filter((b) => b.id !== id));
    if (creatingForBlock === id) {
      setCreatingForBlock(null);
      setNewActivityName("");
    }
  };

  const removeActivity = (name: string) => {
    if (isBreakActivity(name)) return;
    const nextActivities = normalizeActivities(
      activityList.filter((a) => a !== name),
    );
    const fallback =
      nextActivities.find((a) => !isBreakActivity(a)) ?? BREAK_ACTIVITY;
    const nextDraft = draft.map((d) => ({
      ...d,
      blocks: d.blocks.map((b) =>
        b.activity === name
          ? {
              ...b,
              activity: fallback,
              isBreak: isBreakActivity(fallback),
            }
          : b,
      ),
    }));
    setActivityList(nextActivities);
    setDraft(nextDraft);
    setDirty(true);
    setMessage(null);
    setError(null);
  };

  const confirmRenameActivity = async () => {
    if (!user || !renamingActivity) return;
    const from = renamingActivity;
    const to = renameValue.trim();
    if (!to) {
      setError("Digite o novo nome.");
      return;
    }
    if (to.toLowerCase() === from.toLowerCase()) {
      setRenamingActivity(null);
      setRenameValue("");
      return;
    }
    if (
      activityList.some(
        (a) => a.toLowerCase() === to.toLowerCase() && a !== from,
      )
    ) {
      setError("Já existe uma atividade com esse nome.");
      return;
    }

    const renameRoutine = (routine: DayRoutine[]) =>
      routine.map((d) => ({
        ...d,
        blocks: d.blocks.map((b) =>
          b.activity === from
            ? {
                ...b,
                activity: to,
                isBreak: b.isBreak || isBreakActivity(to),
              }
            : b,
        ),
      }));

    // Só grava a rotina já salva + o rename — não publica draft de horários
    const nextCommitted = renameRoutine(weekly);
    const nextDraft = renameRoutine(draft);
    const nextActsCommitted = normalizeActivities(
      activities.map((a) => (a === from ? to : a)),
    );
    const nextActsDraft = normalizeActivities(
      activityList.map((a) => (a === from ? to : a)),
    );

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await renameUserActivity(user.id, from, to);
      await updateProfile({
        startDate: user.start_date,
        paused: user.paused,
        weeklyRoutine: nextCommitted,
        activities: nextActsCommitted,
      });
      applyLocal(nextCommitted, nextActsCommitted, true);
      setActivityList(nextActsDraft);
      setDraft(nextDraft);
      setDirty(false);
      setRenamingActivity(null);
      setRenameValue("");
      setMessage(`“${from}” virou “${to}” — rotina e registros atualizados.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não deu para renomear. Tente de novo.",
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmNewActivity = (blockId: string) => {
    const name = newActivityName.trim();
    if (!name) {
      setError("Digite o nome da nova atividade.");
      return;
    }
    const nextActivities = normalizeActivities([...activityList, name]);
    setActivityList(nextActivities);
    // updateDayBlocks (via patchBlock) já atualiza o draft
    const nextDraft = draft.map((d) =>
      d.dayOfWeek === selectedDay
        ? {
            ...d,
            blocks: sortBlocks(
              d.blocks.map((b) =>
                b.id === blockId
                  ? {
                      ...b,
                      activity: name,
                      isBreak: isBreakActivity(name),
                    }
                  : b,
              ),
            ),
          }
        : d,
    );
    setDraft(nextDraft);
    setDirty(true);
    setCreatingForBlock(null);
    setNewActivityName("");
    setMessage(`Atividade “${name}” adicionada (salve para guardar).`);
    setError(null);
  };

  const resetDefaults = () => {
    const defaults = createEmptyWeeklyRoutine();
    const nextActivities = normalizeActivities([BREAK_ACTIVITY]);
    setDraft(defaults);
    setActivityList(nextActivities);
    setDirty(true);
    setMessage("Rotina em branco restaurada (ainda não salva).");
    setError(null);
  };

  const togglePaused = async () => {
    if (!user) return;
    const nextPaused = !paused;
    setPaused(nextPaused);
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      // Não publica draft não salvo — só altera o flag pausado
      await updateProfile({
        startDate: user.start_date,
        paused: nextPaused,
        weeklyRoutine: weekly,
        activities: normalizeActivities([...activities, BREAK_ACTIVITY]),
      });
      setMessage(
        nextPaused
          ? "Rotina pausada — ponto bloqueado; histórico permanece."
          : "Rotina retomada.",
      );
      // Pausar não mexe no draft — mantém dirty se houver edições
      setPaused(nextPaused);
    } catch (err) {
      setPaused(!nextPaused);
      setError(err instanceof Error ? err.message : "Não deu para atualizar.");
    } finally {
      setSaving(false);
    }
  };

  const onSave = async () => {
    if (!user) return;
    for (const d of draft) {
      const err = validateDayBlocks(d.blocks);
      if (err) {
        setError(`${d.label}: ${err}`);
        setSelectedDay(d.dayOfWeek);
        return;
      }
    }
    const acts = normalizeActivities([...activityList, BREAK_ACTIVITY]);
    setSaving(true);
    try {
      await updateProfile({
        startDate: startDate.trim() || null,
        paused,
        weeklyRoutine: draft,
        activities: acts,
      });
      applyLocal(draft, acts, true);
      setActivityList(acts);
      setDirty(false);
      setMessage("Configuração salva.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não deu para salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (!user || !ready) {
    return <div className="dashboard-loading">Carregando configuração…</div>;
  }

  return (
    <div className="ponto">
      <h1 className="page-title">Configuração</h1>
      <p className="period-caption">
        Conta, data de início e cronograma. A contagem começa na data de início.
        Pausar só bloqueia novas batidas — o que já foi feito permanece.
      </p>

      <section className="card settings-account">
        <h2 className="card-title">Conta</h2>
        <div>
          <strong>{user.display_name}</strong>
          <p className="period-caption" style={{ margin: "0.15rem 0 0" }}>
            @{user.username}
          </p>
        </div>

        <label className="settings-field">
          <span>Data de início</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setDirty(true);
              setMessage(null);
              setError(null);
            }}
          />
        </label>
        <p className="period-caption" style={{ margin: 0 }}>
          {live
            ? "Rotina ativa — você pode bater ponto."
            : paused
              ? "Pausada — ponto bloqueado; o histórico e o saldo já feitos continuam."
              : !startDate
                ? "Defina a data de início para liberar o ponto."
                : "Ainda não liberou — aguarde a data de início."}
        </p>

        <div className="settings-toggle-row">
          <div>
            <strong>
              {paused
                ? "Rotina pausada"
                : live
                  ? "Rotina ativa"
                  : startDate
                    ? "Aguardando data de início"
                    : "Sem data de início"}
            </strong>
          </div>
          <button
            type="button"
            className={paused ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}
            onClick={() => void togglePaused()}
            disabled={saving}
          >
            {paused ? "Retomar rotina" : "Pausar rotina"}
          </button>
        </div>
      </section>

      <div
        className="period-tabs settings-day-tabs"
        role="tablist"
        aria-label="Dia da semana"
      >
        {DAY_ORDER.map((dow) => {
          const item = draft.find((d) => d.dayOfWeek === dow)!;
          return (
            <button
              key={dow}
              type="button"
              role="tab"
              aria-selected={selectedDay === dow}
              className={
                selectedDay === dow ? "period-tab is-active" : "period-tab"
              }
              onClick={() => setSelectedDay(dow)}
            >
              {item.label.slice(0, 3)}
            </button>
          );
        })}
      </div>

      <section className="card">
        <div className="settings-day-head">
          <div>
            <h2 className="card-title" style={{ marginBottom: "0.2rem" }}>
              {day.label}
            </h2>
            <p className="period-caption" style={{ margin: 0 }}>
              {day.blocks.length} bloco(s) ·{" "}
              {workSeconds > 0
                ? `${formatDuration(workSeconds)} de trabalho`
                : "sem trabalho planejado"}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={addBlock}
          >
            <Plus size={16} />
            Bloco
          </button>
        </div>

        {day.blocks.length === 0 ? (
          <p className="empty-move">
            Nenhum horário neste dia. Adicione um bloco.
          </p>
        ) : (
          <ul className="settings-blocks">
            {day.blocks.map((block) => (
              <li key={block.id} className={block.isBreak ? "is-break" : ""}>
                <label className="settings-field">
                  <span>Início</span>
                  <input
                    type="time"
                    value={block.start}
                    onChange={(e) =>
                      patchBlock(block.id, { start: e.target.value })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span>Fim</span>
                  <input
                    type="time"
                    value={block.end}
                    onChange={(e) =>
                      patchBlock(block.id, { end: e.target.value })
                    }
                  />
                </label>
                <div className="settings-field settings-field-grow">
                  <span>Atividade</span>
                  {creatingForBlock === block.id ? (
                    <div className="settings-new-activity">
                      <input
                        type="text"
                        value={newActivityName}
                        placeholder="Nome da atividade"
                        autoFocus
                        onChange={(e) => setNewActivityName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            confirmNewActivity(block.id);
                          }
                          if (e.key === "Escape") {
                            setCreatingForBlock(null);
                            setNewActivityName("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => confirmNewActivity(block.id)}
                      >
                        Ok
                      </button>
                    </div>
                  ) : (
                    <select
                      value={block.activity}
                      onChange={(e) => {
                        if (e.target.value === "__new__") {
                          setCreatingForBlock(block.id);
                          setNewActivityName("");
                          return;
                        }
                        patchBlock(block.id, { activity: e.target.value });
                      }}
                    >
                      {activityList.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                      {!activityList.includes(block.activity) && (
                        <option value={block.activity}>{block.activity}</option>
                      )}
                      <option value="__new__">+ Nova atividade…</option>
                    </select>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost settings-remove"
                  onClick={() => removeBlock(block.id)}
                  aria-label="Remover bloco"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {dayError && <p className="inline-error">{dayError}</p>}
        {!dayError && anyDayError && (
          <p className="inline-error">{anyDayError}</p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Atividades</h2>
        <ul className="activity-edit-list">
          {activityList.map((name) => (
            <li key={name} className="settings-toggle-row">
              {renamingActivity === name ? (
                <div className="settings-new-activity" style={{ flex: 1 }}>
                  <input
                    type="text"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void confirmRenameActivity();
                      }
                      if (e.key === "Escape") {
                        setRenamingActivity(null);
                        setRenameValue("");
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => void confirmRenameActivity()}
                  >
                    Ok
                  </button>
                </div>
              ) : (
                <span>{name}</span>
              )}
              {renamingActivity !== name && (
                <div className="activity-edit-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setRenamingActivity(name);
                      setRenameValue(name);
                      setError(null);
                      setMessage(null);
                    }}
                    aria-label={`Renomear ${name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  {!isBreakActivity(name) && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => removeActivity(name)}
                      aria-label={`Remover ${name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="settings-actions">
        <button type="button" className="btn btn-ghost" onClick={resetDefaults}>
          <RotateCcw size={16} />
          Limpar rotina
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onSave()}
          disabled={saving || Boolean(anyDayError)}
        >
          <Save size={16} />
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>

      {message && <p className="settings-ok">{message}</p>}
      {error && <p className="inline-error">{error}</p>}
    </div>
  );
}
