import { Rng, pick } from './rng';

const FIRST_START = ['Gr', 'Sn', 'Bl', 'P', 'M', 'Tw', 'Fl', 'N', 'W', 'B', 'K', 'R', 'D', 'Z', 'Gl', 'Sk', 'T', 'L', 'Sp', 'Kr', 'Fr', 'Wr'];
const FIRST_MID = ['i', 'u', 'o', 'a', 'ee', 'oo', 'e'];
const FIRST_END = ['b', 'bble', 'dge', 'g', 'ggle', 'k', 'kin', 'mble', 'nk', 'p', 'pkin', 'ps', 'rk', 'sk', 't', 'tch', 'x', 'zzle', 'wick', 'ddle', 'mo', 'na', 'bbin', 'tty'];

const LAST_A = ['Moss', 'Toad', 'Mud', 'Fern', 'Pebble', 'Thistle', 'Mushroom', 'Bramble', 'Puddle', 'Acorn', 'Ember', 'Burrow', 'Clover', 'Nettle', 'Hollow', 'Sprout', 'Root', 'Kettle'];
const LAST_B = ['foot', 'stool', 'nose', 'button', 'whistle', 'bottom', 'patch', 'ear', 'toe', 'pocket', 'tumble', 'sock', 'hat', 'muddle', 'wiggle', 'crumb'];

export function goblinName(rng: Rng): string {
  const first = pick(rng, FIRST_START) + pick(rng, FIRST_MID) + pick(rng, FIRST_END);
  const last = pick(rng, LAST_A) + pick(rng, LAST_B);
  return `${first} ${last}`;
}

const HOLLOW_A = ['Mossy', 'Kettle', 'Thistle', 'Toadstool', 'Bramble', 'Puddle', 'Clover', 'Lantern', 'Pebble', 'Fernwhistle'];
const HOLLOW_B = ['Hollow', 'Knoll', 'Bottom', 'Burrows', 'Dell', 'Hillock', 'Nook', 'Downs'];

export function hollowName(rng: Rng): string {
  return `${pick(rng, HOLLOW_A)} ${pick(rng, HOLLOW_B)}`;
}
