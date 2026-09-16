/** Statistiques descriptives sur une serie de mesures (millisecondes ou gas). */
export function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((a, b) => a + b, 0);
  const moyenne = sum / n;
  const variance = v.reduce((a, b) => a + (b - moyenne) ** 2, 0) / n;
  const q = (p) => v[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  return {
    n,
    moyenne: +moyenne.toFixed(3),
    ecartType: +Math.sqrt(variance).toFixed(3),
    min: +v[0].toFixed(3),
    mediane: +q(0.5).toFixed(3),
    p95: +q(0.95).toFixed(3),
    max: +v[n - 1].toFixed(3),
  };
}

export function ligne(label, s, unite = "ms") {
  return `${label.padEnd(42)} ${String(s.moyenne).padStart(10)} ${String(s.ecartType).padStart(9)} ` +
         `${String(s.mediane).padStart(10)} ${String(s.p95).padStart(10)} ${unite}`;
}

export const ENTETE =
  `${"Mesure".padEnd(42)} ${"moyenne".padStart(10)} ${"ecart-t".padStart(9)} ` +
  `${"mediane".padStart(10)} ${"p95".padStart(10)}`;
