// Djupsortering av splattar, i en egen tråd (Web Worker) så att bilden inte
// hackar medan den pågår. Kör testerna med: node --test
//
// Splattar är halvgenomskinliga och måste ritas bakifrån och fram. Ordningen
// beror på varifrån man tittar, så den räknas om när huvudet rör sig. Det är
// en räknesortering på 16-bitars djup: linjär tid, och tillräckligt noggrann
// eftersom två splattar som hamnar i samma fack ändå ligger nästan lika djupt.
'use strict';

// Ger index sorterade från längst bort till närmast. Djupet är z i vyrummet,
// som är negativt framför ögat – det minsta talet ligger alltså längst bort.
function sorteraDjup(positioner, antal, mv, fack = new Uint32Array(65536)) {
  const djup = new Float32Array(antal);
  let min = Infinity, max = -Infinity;
  const a = mv[2], b = mv[6], c = mv[10], d = mv[14];
  for (let i = 0; i < antal; i++) {
    const z = a * positioner[i * 3] + b * positioner[i * 3 + 1] + c * positioner[i * 3 + 2] + d;
    djup[i] = z;
    if (z < min) min = z;
    if (z > max) max = z;
  }
  const skala = max > min ? 65535 / (max - min) : 0;
  const nyckel = new Uint16Array(antal);
  fack.fill(0);
  for (let i = 0; i < antal; i++) {
    const k = ((djup[i] - min) * skala) | 0;
    nyckel[i] = k;
    fack[k]++;
  }
  let summa = 0;
  for (let k = 0; k < 65536; k++) { const n = fack[k]; fack[k] = summa; summa += n; }
  const ordning = new Uint32Array(antal);
  for (let i = 0; i < antal; i++) ordning[fack[nyckel[i]]++] = i;
  return ordning;
}

if (typeof module === 'object' && module.exports) {
  module.exports = { sorteraDjup };
} else if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  let positioner = null, antal = 0, generation = 0;
  const fack = new Uint32Array(65536);
  self.onmessage = (e) => {
    const m = e.data;
    if (m.typ === 'data') {
      positioner = m.positioner; antal = m.antal; generation = m.generation;
    } else if (m.typ === 'sortera' && positioner && m.generation === generation) {
      const ordning = sorteraDjup(positioner, antal, m.mv, fack);
      self.postMessage({ typ: 'ordning', ordning, generation, mv: m.mv }, [ordning.buffer]);
    }
  };
}
