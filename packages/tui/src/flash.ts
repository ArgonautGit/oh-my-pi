/**
 * flash.nvim-style label jump.
 *
 * The search, ordering and label-assignment rules behind the editor's
 * `tui.editor.flash` submode, plus the overlay primitive that paints matches
 * and labels onto an already-rendered terminal row.
 *
 * Everything here is pure: no terminal, no component state. The editor
 * recomputes a whole {@link FlashState} from `(lines, cursor, query)` on every
 * keystroke, so the algorithm is directly unit-testable.
 */

/** Label alphabet, home row first (flash.nvim's default ordering). */
export const FLASH_LABEL_ALPHABET = "asdfghjklqwertyuiopzxcvbnm";

export interface FlashPosition {
	/** Logical buffer line index. */
	line: number;
	/** Code-unit column within that line. */
	col: number;
}

/** One query occurrence, covering `[col, end)` code units of `line`. */
export interface FlashMatch extends FlashPosition {
	/** Exclusive code-unit column where the match ends. */
	end: number;
}

export interface FlashLabeledMatch extends FlashMatch {
	/** Single-character jump label; `null` once the alphabet is exhausted. */
	label: string | null;
}

/** The editor's entire flash submode state. */
export interface FlashState {
	query: string;
	/** Ordered nearest-to-cursor first, so `matches[0]` is the Enter target. */
	matches: readonly FlashLabeledMatch[];
}

/** Flash mode just entered: active, nothing typed yet. */
export const EMPTY_FLASH_STATE: FlashState = Object.freeze({ query: "", matches: [] as readonly FlashLabeledMatch[] });

/**
 * Lowercase without moving code-unit offsets: the few scalars whose lowercase
 * form has a different length (`İ`) are left alone so match columns stay exact.
 */
function foldCase(text: string): string {
	const lower = text.toLowerCase();
	if (lower.length === text.length) return lower;
	let out = "";
	for (const ch of text) {
		const chLower = ch.toLowerCase();
		out += chLower.length === ch.length ? chLower : ch;
	}
	return out;
}

/** Nearest-first ordering: lines away, then forward before backward, then columns away. */
function compareByCursorDistance(a: FlashMatch, b: FlashMatch, cursor: FlashPosition): number {
	const lineDistance = Math.abs(a.line - cursor.line) - Math.abs(b.line - cursor.line);
	if (lineDistance !== 0) return lineDistance;
	// Ties go to the match at or after the cursor in document order.
	const aBackward = a.line > cursor.line || (a.line === cursor.line && a.col >= cursor.col) ? 0 : 1;
	const bBackward = b.line > cursor.line || (b.line === cursor.line && b.col >= cursor.col) ? 0 : 1;
	if (aBackward !== bBackward) return aBackward - bBackward;
	const colDistance = Math.abs(a.col - cursor.col) - Math.abs(b.col - cursor.col);
	if (colDistance !== 0) return colDistance;
	if (a.line !== b.line) return a.line - b.line;
	return a.col - b.col;
}

/**
 * Every occurrence of `query` across `lines`, ordered nearest-to-cursor first.
 *
 * Matching is smartcase. Occurrences never overlap — the scan resumes past the
 * previous match — so the cell right after a match belongs to exactly one of
 * them and can carry its label unambiguously.
 */
export function findMatches(lines: readonly string[], query: string, cursor: FlashPosition): FlashMatch[] {
	if (query.length === 0) return [];
	// Smartcase: a query with no uppercase character matches case-insensitively.
	const insensitive = query === query.toLowerCase();
	const needle = insensitive ? foldCase(query) : query;
	const matches: FlashMatch[] = [];
	for (let line = 0; line < lines.length; line++) {
		const raw = lines[line] ?? "";
		if (raw.length < needle.length) continue;
		const haystack = insensitive ? foldCase(raw) : raw;
		for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
			matches.push({ line, col: at, end: at + needle.length });
		}
	}
	matches.sort((a, b) => compareByCursorDistance(a, b, cursor));
	return matches;
}

/**
 * `alphabet` minus every character that already follows a match (lowercase
 * folded). Typing one of those characters extends the query, so excluding them
 * keeps "pick a label" and "narrow the search" from ever colliding.
 */
export function availableLabels(
	matches: readonly FlashMatch[],
	lines: readonly string[],
	alphabet: string = FLASH_LABEL_ALPHABET,
): string[] {
	const excluded = new Set<string>();
	for (const match of matches) {
		const line = lines[match.line];
		if (line === undefined) continue;
		const codePoint = line.codePointAt(match.end);
		if (codePoint === undefined) continue;
		excluded.add(String.fromCodePoint(codePoint).toLowerCase());
	}
	const pool: string[] = [];
	for (const label of alphabet) {
		if (!excluded.has(label.toLowerCase())) pool.push(label);
	}
	return pool;
}

/**
 * Hand out one label per match in the order given (i.e. nearest to the cursor
 * gets the first label). Matches past the end of the pool get `null`.
 */
export function assignLabels(
	matches: readonly FlashMatch[],
	lines: readonly string[],
	alphabet: string = FLASH_LABEL_ALPHABET,
): FlashLabeledMatch[] {
	const pool = availableLabels(matches, lines, alphabet);
	return matches.map((match, index) => ({ ...match, label: pool[index] ?? null }));
}

/** Full state for a query. A query with no matches keeps the mode alive with no labels. */
export function computeFlashState(
	lines: readonly string[],
	cursor: FlashPosition,
	query: string,
	alphabet: string = FLASH_LABEL_ALPHABET,
): FlashState {
	if (query.length === 0) return EMPTY_FLASH_STATE;
	return { query, matches: assignLabels(findMatches(lines, query, cursor), lines, alphabet) };
}

/** The match `char` labels, if any. Labels are exact — case is never folded here. */
export function findFlashLabel(state: FlashState, char: string): FlashLabeledMatch | undefined {
	for (const match of state.matches) {
		if (match.label === char) return match;
	}
	return undefined;
}

/** Underline matched query text. Uses on/off codes so surrounding SGR state survives. */
export function styleFlashMatch(text: string): string {
	return `\x1b[4m${text}\x1b[24m`;
}

/** Bold reverse-video label glyph. Uses on/off codes so surrounding SGR state survives. */
export function styleFlashLabel(label: string): string {
	return `\x1b[1;7m${label}\x1b[27;22m`;
}

/** Dim backdrop over non-match text while the mode is active. On/off codes so surrounding SGR state survives. */
export function styleFlashBackdrop(text: string): string {
	return `\x1b[2m${text}\x1b[22m`;
}

/**
 * A styling instruction addressed in *plain* code-unit offsets of a string that
 * may already contain ANSI escapes.
 */
export interface FlashSpan {
	/** Plain (escape-free) code-unit offset where the span starts. */
	start: number;
	/** Exclusive end offset. `end <= start` with `replaceWith` set is an insertion. */
	end: number;
	/** Higher priority claims contested cells; lower-priority spans are clipped around it. */
	priority: number;
	/** Literal, already-styled replacement for the covered plain text. */
	replaceWith?: string;
	/** Wraps the covered plain text. Ignored when `replaceWith` is set. */
	style?: (text: string) => string;
}

interface ResolvedSpan {
	start: number;
	end: number;
	replaceWith?: string;
	style?: (text: string) => string;
}

/** Index just past the escape sequence starting at `i` (where `text[i] === "\x1b"`). */
function escapeSequenceEnd(text: string, i: number): number {
	if (i + 1 >= text.length) return text.length;
	const introducer = text.charCodeAt(i + 1);
	// CSI: parameter/intermediate bytes then a final byte in @..~
	if (introducer === 0x5b) {
		let j = i + 2;
		while (j < text.length) {
			const code = text.charCodeAt(j);
			j++;
			if (code >= 0x40 && code <= 0x7e) break;
		}
		return j;
	}
	// DCS/SOS/OSC/PM/APC: string sequences terminated by BEL or ST. CURSOR_MARKER is an APC.
	if (
		introducer === 0x50 ||
		introducer === 0x58 ||
		introducer === 0x5d ||
		introducer === 0x5e ||
		introducer === 0x5f
	) {
		let j = i + 2;
		while (j < text.length) {
			const code = text.charCodeAt(j);
			if (code === 0x07) return j + 1;
			if (code === 0x1b && text.charCodeAt(j + 1) === 0x5c) return j + 2;
			j++;
		}
		return text.length;
	}
	return i + 2;
}

/** `offsets[p]` = index in `text` of the p-th plain code unit; last entry is `text.length`. */
function plainOffsets(text: string): number[] {
	const offsets: number[] = [];
	let i = 0;
	while (i < text.length) {
		if (text.charCodeAt(i) === 0x1b) {
			i = escapeSequenceEnd(text, i);
			continue;
		}
		offsets.push(i);
		i++;
	}
	offsets.push(text.length);
	return offsets;
}

/** Escape sequences inside `[from, to)`, so replacing plain text keeps SGR state balanced. */
function escapesWithin(text: string, from: number, to: number): string {
	let out = "";
	let i = from;
	while (i < to) {
		if (text.charCodeAt(i) === 0x1b) {
			const end = Math.min(escapeSequenceEnd(text, i), to);
			out += text.slice(i, end);
			i = end;
			continue;
		}
		i++;
	}
	return out;
}

function resolveSpans(spans: readonly FlashSpan[], plainLength: number): ResolvedSpan[] {
	const claimed = new Uint8Array(plainLength);
	const inserted = new Set<number>();
	const resolved: ResolvedSpan[] = [];
	const ordered = [...spans].sort((a, b) => b.priority - a.priority || a.start - b.start);

	for (const span of ordered) {
		// A span that starts past the rendered text is dropped rather than clamped:
		// clamping would paint it at a column it does not belong to.
		if (span.start < 0 || span.start > plainLength) continue;
		const end = Math.min(span.end, plainLength);

		if (end <= span.start) {
			if (span.replaceWith === undefined || inserted.has(span.start)) continue;
			inserted.add(span.start);
			resolved.push({ start: span.start, end: span.start, replaceWith: span.replaceWith });
			continue;
		}

		if (span.replaceWith !== undefined) {
			// A replacement is all-or-nothing: a partially covered glyph would corrupt width.
			let free = true;
			for (let i = span.start; i < end && free; i++) free = claimed[i] === 0;
			if (!free) continue;
			for (let i = span.start; i < end; i++) claimed[i] = 1;
			resolved.push({ start: span.start, end, replaceWith: span.replaceWith });
			continue;
		}

		const style = span.style;
		if (style === undefined) continue;
		// Styling survives contention: emit each still-free run separately.
		let runStart = -1;
		for (let i = span.start; i <= end; i++) {
			if (i === end || claimed[i] === 1) {
				if (runStart !== -1) {
					resolved.push({ start: runStart, end: i, style });
					runStart = -1;
				}
				continue;
			}
			claimed[i] = 1;
			if (runStart === -1) runStart = i;
		}
	}

	// Insertions sort ahead of the span they sit at the front of.
	resolved.sort((a, b) => a.start - b.start || a.end - b.end);
	return resolved;
}

/**
 * Paint `spans` onto `text`, which may already carry ANSI escapes (decorations,
 * the cursor glyph, the TUI cursor marker). Offsets address plain code units;
 * escapes are stepped over, never counted and never dropped.
 */
export function applyFlashSpans(text: string, spans: readonly FlashSpan[]): string {
	if (spans.length === 0) return text;
	const offsets = plainOffsets(text);
	const resolved = resolveSpans(spans, offsets.length - 1);
	if (resolved.length === 0) return text;

	let out = "";
	let cut = 0;
	for (const span of resolved) {
		const from = offsets[span.start]!;
		const to = offsets[span.end]!;
		out += text.slice(cut, from);
		if (span.replaceWith !== undefined) {
			out += span.replaceWith + escapesWithin(text, from, to);
		} else if (span.style !== undefined) {
			out += span.style(text.slice(from, to));
		}
		cut = to;
	}
	return out + text.slice(cut);
}
