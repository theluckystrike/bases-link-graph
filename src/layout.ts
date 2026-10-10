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
export function createLayout(n: number, edges: [number, number][], opts: LayoutOptions = {}, saved: ([number, number] | null)[] = [], fixSaved = false): LayoutState {
	const x = new Float64Array(n);
	const y = new Float64Array(n);
	const fixed = new Uint8Array(n);
	const deg = new Uint32Array(n);
	const flat = new Int32Array(edges.length * 2);
	edges.forEach(([s, t], k) => {
		flat[2 * k] = s;
		flat[2 * k + 1] = t;
		deg[s]!++;
		deg[t]!++;
	});
	const strength = new Float64Array(edges.length);
	edges.forEach(([s, t], k) => {
		strength[k] = 1 / Math.max(1, Math.min(deg[s]!, deg[t]!));
	});
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
		for (let k = 0; k < edges.length; k++) {
			const [s, t] = edges[k]!;
			const a = saved[s] ? t : saved[t] ? s : -1;
			const b = a === t ? s : t;
			if (a < 0 || saved[a]) continue;
			x[a] = x[b]! + 20 * Math.cos(a * GOLDEN);
			y[a] = y[b]! + 20 * Math.sin(a * GOLDEN);
		}
	}
	return {
		n,
		x,
		y,
		vx: new Float64Array(n),
		vy: new Float64Array(n),
		fixed,
		edges: flat,
		strength,
		alpha: known > 0 && known >= n * 0.8 ? 0.3 : 1,
		alphaMin: 0.002,
		alphaDecay: 1 - Math.pow(0.002, 1 / 300),
		alphaTarget: 0,
		opts: { ...DEFAULTS, ...opts },
		ticks: 0,
	};
}

function repelExact(s: LayoutState, k: number): void {
	const { n, x, y, vx, vy } = s;
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
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
	const { n, x, y, vx, vy } = s;
	const cell = s.opts.linkDistance * 3;
	const grid = new Map<string, number[]>();
	for (let i = 0; i < n; i++) {
		const key = `${Math.floor(x[i]! / cell)},${Math.floor(y[i]! / cell)}`;
		const list = grid.get(key);
		if (list) list.push(i);
		else grid.set(key, [i]);
	}
	const c2 = cell * cell;
	for (let i = 0; i < n; i++) {
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
	const { n, x, y, vx, vy, edges, strength, fixed, alpha, opts } = s;
	const k = opts.repel * alpha;
	if (n <= GRID_FROM) repelExact(s, k);
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
	for (let i = 0; i < n; i++) {
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
	s.ticks++;
	return true;
}

/** Runs ticks until the layout cools, `maxTicks` is reached or `budgetMs` passes. Returns the ticks run. */
export function run(s: LayoutState, maxTicks: number, budgetMs = Infinity, now: () => number = () => performance.now()): number {
	const t0 = now();
	let done = 0;
	while (done < maxTicks && tick(s)) {
		done++;
		if ((done & 7) === 0 && now() - t0 > budgetMs) break;
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
