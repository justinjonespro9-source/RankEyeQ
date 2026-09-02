/**
 * Competition ranking (“1224”) ascending: lower values rank better.
 * Used for average predicted rank (best = #1).
 */
export function assignCompetitionRanksAscending<T>(
  items: T[],
  getValue: (item: T) => number,
): Array<{ item: T; rank: number; value: number }> {
  const indexed = items.map((item, index) => ({
    item,
    index,
    value: getValue(item),
  }));

  indexed.sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return a.index - b.index;
  });

  const result: Array<{ item: T; rank: number; value: number }> = [];
  let i = 0;
  while (i < indexed.length) {
    const value = indexed[i].value;
    let j = i + 1;
    while (j < indexed.length && indexed[j].value === value) j += 1;
    const rank = i + 1;
    for (let k = i; k < j; k += 1) {
      result.push({
        item: indexed[k].item,
        rank,
        value,
      });
    }
    i = j;
  }

  return result;
}

/**
 * Competition ranking (“1224”): equal scores share the same rank;
 * the next rank skips ahead by the size of the tied group.
 * Does not break ties by name or external ID.
 */
export function assignCompetitionRanks<T>(
  items: T[],
  getScore: (item: T) => number,
): Array<{ item: T; rank: number; score: number }> {
  const indexed = items.map((item, index) => ({
    item,
    index,
    score: getScore(item),
  }));

  indexed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable only — does not affect assigned rank for ties.
    return a.index - b.index;
  });

  const result: Array<{ item: T; rank: number; score: number }> = [];
  let i = 0;
  while (i < indexed.length) {
    const score = indexed[i].score;
    let j = i + 1;
    while (j < indexed.length && indexed[j].score === score) j += 1;
    const rank = i + 1;
    for (let k = i; k < j; k += 1) {
      result.push({
        item: indexed[k].item,
        rank,
        score,
      });
    }
    i = j;
  }

  return result;
}
