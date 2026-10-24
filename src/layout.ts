// A small force layout (no library): many-body repulsion, link springs and a pull to the center, cooled by alpha
// like d3-force. Pure and deterministic: the same nodes, edges and saved positions give the same layout.
// Repulsion is exact (all pairs) up to GRID_FROM nodes, and uses a uniform grid with a cutoff above that.

export interface LayoutOptions {
	/** Rest length of a link spring, px. */
	linkDistance?: number;
	/** Repulsion strength (larger spreads the graph). */
	repel?: number;
	/** Pull of every node to (0, 0), 0..1. Keeps separate parts of the graph near each other. */
	gravity?: number;
	/** Velocity kept per tick, 0..1. */
	friction?: number;
}

export interface LayoutState {
	n: number;
	x: Float64Array;
	y: Float64Array;
	vx: Float64Array;
	vy: Float64Array;
	/** 1 = the node does not move (dragged or from a saved layout). */
	fixed: Uint8Array;
	/** Edge list as [s0, t0, s1, t1, ...]. */
	edges: Int32Array;
	/** Spring strength per edge: 1 / min(degree of its ends). */
	strength: Float64Array;
	/** Nodes in the simulation (not satellites), in index order. */
	bodies: Int32Array;
	/** Parent index of a satellite node (a heading or block on its note), -1 for a body. */
	parent: Int32Array;
	/** Satellites in index order with their angle step data: [node, slot, count] triples. */
	sats: Int32Array;
	alpha: number;
	alphaMin: number;
	alphaDecay: number;
	alphaTarget: number;
	opts: Required<LayoutOptions>;
	ticks: number;
}

export const DEFAULTS: Required<LayoutOptions> = { linkDistance: 60, repel: 220, gravity: 0.04, friction: 0.6 };
export const GRID_FROM = 1200;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * New layout. `saved[i]` (if given) is a start position; those nodes are fixed when `fixSaved` is true, and the
 * layout starts cool (alpha 0.3) when most nodes have a position, so a saved layout keeps its shape.
 */
export function createLayout(n: number, edges: [number, number][], opts: LayoutOptions = {}, saved: ([number, number] | null)[] = [], fixSaved = false, parents: ArrayLike<number> = []): LayoutState {
	const x = new Float64Array(n);
	const y = new Float64Array(n);
	const fixed = new Uint8Array(n);
	const deg = new Uint32Array(n);
	// Satellites (heading and block nodes) are not in the simulation: each tick places them around their parent,
	// so their cost stays out of the repulsion. A parent always has a lower index than its satellite.
	const parent = new Int32Array(n).fill(-1);
	for (let i = 0; i < n; i++) {
		const p = parents[i] ?? -1;
		if (p >= 0 && p < i) parent[i] = p;
	}
	const root = (i: number): number => {
		let r = i;
		while (parent[r]! >= 0) r = parent[r]!;
		return r;
	};
	// An edge to a satellite pulls on its note; edges inside one note (part lines) drop out.
	const springs: [number, number][] = [];
	for (const [s, t] of edges) {
		const a = root(s);
		const b = root(t);
		if (a !== b) springs.push([a, b]);
	}
	const flat = new Int32Array(springs.length * 2);
	springs.forEach(([s, t], k) => {
		flat[2 * k] = s;
		flat[2 * k + 1] = t;
		deg[s]!++;
		deg[t]!++;
	});
	const strength = new Float64Array(springs.length);
	springs.forEach(([s, t], k) => {
		strength[k] = 1 / Math.max(1, Math.min(deg[s]!, deg[t]!));
	});
	const bodyList: number[] = [];
	const satList: number[] = [];
	const children = new Map<number, number>();
	for (let i = 0; i < n; i++) {
		if (parent[i]! < 0) {
			bodyList.push(i);
			continue;
		}
		const c = children.get(parent[i]!) ?? 0;
		satList.push(i, c, 0);
		children.set(parent[i]!, c + 1);
	}
	for (let k = 0; k < satList.length; k += 3) satList[k + 2] = children.get(parent[satList[k]!]!)!;
	let known = 0;
	// Phyllotaxis start (as d3-force): evenly spread, no randomness.
	for (let i = 0; i < n; i++) {
		const p = saved[i];
		if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
			x[i] = p[0];
			y[i] = p[1];
			if (fixSaved) fixed[i] = 1;
			known++;
			continue;
		}
		const r = 10 * Math.sqrt(0.5 + i);
		x[i] = r * Math.cos(i * GOLDEN);
		y[i] = r * Math.sin(i * GOLDEN);
	}
	// A new node placed next to a saved neighbour instead of the phyllotaxis spot.
	if (known > 0 && known < n) {
		for (let k = 0; k < springs.length; k++) {
			const [s, t] = springs[k]!;
			const a = saved[s] ? t : saved[t] ? s : -1;
			const b = a === t ? s : t;
			if (a < 0 || saved[a]) continue;
			x[a] = x[b]! + 20 * Math.cos(a * GOLDEN);
			y[a] = y[b]! + 20 * Math.sin(a * GOLDEN);
		}
	}
	const state: LayoutState = {
		n,
		x,
		y,
		vx: new Float64Array(n),
		vy: new Float64Array(n),
		fixed,
		edges: flat,
		strength,
		bodies: Int32Array.from(bodyList),
		parent,
		sats: Int32Array.from(satList),
		alpha: known > 0 && known >= n * 0.8 ? 0.3 : 1,
		alphaMin: 0.002,
		alphaDecay: 1 - Math.pow(0.002, 1 / 300),
		alphaTarget: 0,
		opts: { ...DEFAULTS, ...opts },
		ticks: 0,
	};
	placeSatellites(state);
	return state;
}

/** Ring radius of the satellites of a note, in layout units. */
export function satelliteRadius(s: LayoutState): number {
	return Math.max(14, s.opts.linkDistance * 0.4);
}

/**
 * Places each satellite around its parent: evenly on a ring around a note, or in a fan that points away from the
 * parent's own parent for a nested heading. Parents come first in index order, so one pass places a whole chain.
 */
export function placeSatellites(s: LayoutState): void {
	const { x, y, parent, sats } = s;
	const r1 = satelliteRadius(s);
	for (let k = 0; k < sats.length; k += 3) {
		const i = sats[k]!;
		const slot = sats[k + 1]!;
		const count = sats[k + 2]!;
		const p = parent[i]!;
		const gp = parent[p]!;
		let a: number;
		let r: number;
		if (gp < 0) {
			a = p * GOLDEN + (2 * Math.PI * slot) / count;
			r = r1;
		} else {
			a = Math.atan2(y[p]! - y[gp]!, x[p]! - x[gp]!) + (slot - (count - 1) / 2) * 0.5;
			r = r1 * 0.7;
		}
		x[i] = x[p]! + r * Math.cos(a);
		y[i] = y[p]! + r * Math.sin(a);
	}
}

function repelExact(s: LayoutState, k: number): void {
	const { x, y, vx, vy, bodies } = s;
	const n = bodies.length;
	for (let bi = 0; bi < n; bi++) {
		const i = bodies[bi]!;
		for (let bj = bi + 1; bj < n; bj++) {
			const j = bodies[bj]!;
			let dx = x[j]! - x[i]!;
			let dy = y[j]! - y[i]!;
			let d2 = dx * dx + dy * dy;
			if (d2 < 1e-6) {
				// Same spot: push apart along a fixed direction so the result stays deterministic.
				dx = 0.1 * (((i * 7 + j) % 5) - 2) || 0.1;
				dy = 0.1;
				d2 = dx * dx + dy * dy;
			}
			if (d2 < 25) d2 = 25;
			const f = k / d2;
			vx[i]! -= dx * f;
			vy[i]! -= dy * f;
			vx[j]! += dx * f;
			vy[j]! += dy * f;
		}
	}
}

/** Repulsion with a cutoff of 3 link distances, through a uniform grid. Used for large graphs only. */
function repelGrid(s: LayoutState, k: number): void {
	const { x, y, vx, vy, bodies } = s;
	const cell = s.opts.linkDistance * 3;
	const grid = new Map<string, number[]>();
	for (const i of bodies) {
		const key = `${Math.floor(x[i]! / cell)},${Math.floor(y[i]! / cell)}`;
		const list = grid.get(key);
		if (list) list.push(i);
		else grid.set(key, [i]);
	}
	const c2 = cell * cell;
	for (const i of bodies) {
		const cx = Math.floor(x[i]! / cell);
		const cy = Math.floor(y[i]! / cell);
		for (let gx = cx - 1; gx <= cx + 1; gx++) {
			for (let gy = cy - 1; gy <= cy + 1; gy++) {
				for (const j of grid.get(`${gx},${gy}`) ?? []) {
					if (j <= i) continue;
					const dx = x[j]! - x[i]! || 0.1;
					const dy = y[j]! - y[i]!;
					let d2 = dx * dx + dy * dy;
					if (d2 > c2) continue;
					if (d2 < 25) d2 = 25;
					const f = k / d2;
					vx[i]! -= dx * f;
					vy[i]! -= dy * f;
					vx[j]! += dx * f;
					vy[j]! += dy * f;
				}
			}
		}
	}
}

/** One step of the simulation. Returns false when the layout has cooled down (alpha below alphaMin). */
export function tick(s: LayoutState): boolean {
	if (s.alpha < s.alphaMin && s.alphaTarget < s.alphaMin) return false;
	s.alpha += (s.alphaTarget - s.alpha) * s.alphaDecay;
	const { x, y, vx, vy, edges, strength, fixed, alpha, opts, bodies } = s;
	const k = opts.repel * alpha;
	if (bodies.length <= GRID_FROM) repelExact(s, k);
	else repelGrid(s, k);
	const m = edges.length / 2;
	for (let e = 0; e < m; e++) {
		const a = edges[2 * e]!;
		const b = edges[2 * e + 1]!;
		let dx = x[b]! + vx[b]! - x[a]! - vx[a]!;
		let dy = y[b]! + vy[b]! - y[a]! - vy[a]!;
		const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
		const f = ((d - opts.linkDistance) / d) * alpha * strength[e]! * 0.5;
		dx *= f;
		dy *= f;
		vx[a]! += dx;
		vy[a]! += dy;
		vx[b]! -= dx;
		vy[b]! -= dy;
	}
	const g = opts.gravity * alpha;
	const keep = opts.friction;
	for (const i of bodies) {
		if (fixed[i]) {
			vx[i] = 0;
			vy[i] = 0;
			continue;
		}
		vx[i]! -= x[i]! * g;
		vy[i]! -= y[i]! * g;
		vx[i]! *= keep;
		vy[i]! *= keep;
		x[i]! += vx[i]!;
		y[i]! += vy[i]!;
	}
	placeSatellites(s);
	s.ticks++;
	return true;
}

/** Runs ticks until the layout cools, `maxTicks` is reached or `budgetMs` passes. Returns the ticks run. */
export function run(s: LayoutState, maxTicks: number, budgetMs = Infinity, now: () => number = () => performance.now()): number {
	const t0 = now();
	let done = 0;
	// A large graph checks the clock after each tick: one tick there can take several milliseconds.
	const every = s.bodies.length > GRID_FROM ? 0 : 7;
	while (done < maxTicks && tick(s)) {
		done++;
		if ((done & every) === 0 && now() - t0 > budgetMs) break;
	}
	return done;
}

/** Heats the layout again (after a drag or new data). */
export function reheat(s: LayoutState, alpha = 0.3): void {
	s.alpha = Math.max(s.alpha, alpha);
}

/** Bounding box of all nodes as [minX, minY, maxX, maxY]; [0, 0, 0, 0] when empty. */
export function bounds(s: LayoutState): [number, number, number, number] {
	if (s.n === 0) return [0, 0, 0, 0];
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (let i = 0; i < s.n; i++) {
		x0 = Math.min(x0, s.x[i]!);
		y0 = Math.min(y0, s.y[i]!);
		x1 = Math.max(x1, s.x[i]!);
		y1 = Math.max(y1, s.y[i]!);
	}
	return [x0, y0, x1, y1];
}

/** Index of the node under (px, py) in layout space, within its radius plus `slop`; -1 when none. Last drawn wins. */
export function hitTest(s: LayoutState, radius: ArrayLike<number>, px: number, py: number, slop = 2): number {
	for (let i = s.n - 1; i >= 0; i--) {
		const dx = s.x[i]! - px;
		const dy = s.y[i]! - py;
		const r = (radius[i] ?? 0) + slop;
		if (dx * dx + dy * dy <= r * r) return i;
	}
	return -1;
}
