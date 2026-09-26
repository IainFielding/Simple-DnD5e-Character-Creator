/**
 * Spell-level caps for a level-up that gains several levels at once.
 *
 * A caster learns its spells one level at a time, and each spell learned must be of a level it has
 * slots for *at that level*. A 2014 Sorcerer going from 1st to 9th level learns one spell at each
 * of 2nd through 9th level, so it ends with one spell of 5th level at most, not eight. Asking for
 * all of those picks on one screen, bounded only by the final level's slots, let the player take
 * eight 5th-level spells — and a Wizard sixteen, into its book.
 *
 * So each pick the level-up owes carries a **cap**: the highest spell level the class could cast at
 * the level that pick comes from. A cap holds a spell of its level or anything lower, which is the
 * magic item shop's rarity-slot rule ({@link module:data/magic-shop.assignSlots}) with spell levels
 * for rarities. Caps are plain arrays of numbers, highest first; a pick list fits them when, both
 * sorted highest first, every pick is at or below the cap beside it.
 *
 * Pure: no Foundry globals, so the arithmetic is unit-tested directly.
 * @module data/spell-level-caps
 */

const desc = (a, b) => b - a;

/**
 * The caps a run of gained levels owes: for each class level from `from + 1` to `to`, one cap per
 * pick that level adds, at the spell level the class could cast there. The total is then made to
 * agree with `total`, the picks the level-up actually offers: picks it owes beyond the ladder (a
 * spell left unchosen at an earlier level, or one a merge hands back) are capped at the spell level
 * of the level the character is leaving; a ladder longer than the offer (the character already had
 * more than its count) keeps its highest caps.
 * @param {object} options
 * @param {number} options.from                   Class level before the level-up (0 for a new class).
 * @param {number} options.to                     Class level after it.
 * @param {number} options.total                  Picks the level-up offers.
 * @param {(level:number) => number} options.countAt  Picks owed in total by a class level.
 * @param {(level:number) => number} options.capAt    Highest castable spell level at a class level.
 * @returns {number[]}  One cap per pick, highest first.
 */
export function ladderCaps({ from, to, total, countAt, capAt }) {
  const caps = [];
  for ( let level = from + 1; level <= to; level++ ) {
    const cap = capAt(level);
    const added = Math.max(0, countAt(level) - countAt(level - 1));
    if ( cap > 0 ) for ( let i = 0; i < added; i++ ) caps.push(cap);
  }
  caps.sort(desc);
  if ( caps.length > total ) return caps.slice(0, Math.max(0, total));
  const earlier = capAt(from) || (caps.length ? caps[caps.length - 1] : 0) || capAt(to);
  while ( caps.length < total ) caps.push(earlier);
  return caps.sort(desc);
}

/**
 * Whether a set of picks fits the caps: each seated, highest first, beside a cap at least its level.
 * @param {number[]} levels  Spell levels of the picks.
 * @param {number[]} caps
 * @returns {boolean}
 */
export function fitsCaps(levels, caps) {
  if ( levels.length > caps.length ) return false;
  const picks = [...levels].sort(desc);
  const slots = [...caps].sort(desc);
  return picks.every((level, i) => level <= slots[i]);
}

/**
 * Whether one more pick of `level` would still fit.
 * @param {number[]} levels
 * @param {number} level
 * @param {number[]} caps
 * @returns {boolean}
 */
export function canAddLevel(levels, level, caps) {
  return fitsCaps([...levels, level], caps);
}

/**
 * Drop picks until the rest fit, highest level first, since those are the ones a lost cap strands.
 * Mutates and returns `picks`.
 * @template {{level:number}} T
 * @param {T[]} picks
 * @param {number[]} caps
 * @returns {T[]}
 */
export function trimToCaps(picks, caps) {
  while ( picks.length && !fitsCaps(picks.map(p => Number(p.level) || 0), caps) ) {
    let at = 0;
    picks.forEach((p, i) => { if ( (Number(p.level) || 0) >= (Number(picks[at].level) || 0) ) at = i; });
    picks.splice(at, 1);
  }
  return picks;
}

/**
 * The chips for the tally: one per cap level, with how many of its picks are used. Picks are seated
 * highest level first, each beside the lowest cap that holds it, so the high caps show as free for
 * as long as anything could still use them.
 * @param {number[]} levels
 * @param {number[]} caps
 * @returns {{level:number, used:number, allowed:number, full:boolean}[]}  Lowest cap first, the way
 *   the magic shop lists its rarities.
 */
export function capSummary(levels, caps) {
  const allowed = new Map();
  for ( const cap of caps ) allowed.set(cap, (allowed.get(cap) ?? 0) + 1);
  const free = new Map(allowed);
  const used = new Map();
  const ladder = [...allowed.keys()].sort((a, b) => a - b);
  for ( const level of [...levels].sort(desc) ) {
    const cap = ladder.find(c => (c >= level) && (free.get(c) > 0));
    if ( cap === undefined ) continue;
    free.set(cap, free.get(cap) - 1);
    used.set(cap, (used.get(cap) ?? 0) + 1);
  }
  return ladder.map(level => {
    const n = used.get(level) ?? 0;
    return { level, used: n, allowed: allowed.get(level), full: n >= allowed.get(level) };
  });
}
