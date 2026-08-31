/** Todo usuário novo nasce com perfil vazio e pausado. */
export function blankProfile() {
  const labels = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];
  return {
    startDate: null,
    paused: true,
    weekly: [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({
      dayOfWeek,
      label: labels[dayOfWeek],
      blocks: [],
    })),
    activities: ["Descanso"],
  };
}
