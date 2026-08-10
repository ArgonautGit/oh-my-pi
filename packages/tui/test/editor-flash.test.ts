import { afterEach, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER } from "@oh-my-pi/pi-tui";
import { Editor } from "@oh-my-pi/pi-tui/components/editor";
import {
	applyFlashSpans,
	assignLabels,
	availableLabels,
	computeFlashState,
	FLASH_LABEL_ALPHABET,
	findFlashLabel,
	findMatches,
	styleFlashBackdrop,
	styleFlashLabel,
	styleFlashMatch,
} from "@oh-my-pi/pi-tui/flash";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@oh-my-pi/pi-tui/keybindings";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";
import { defaultEditorTheme } from "./test-themes";

const FLASH = "\x1bj"; // alt+j
const ESCAPE = "\x1b";
const BACKSPACE = "\x7f";
const ENTER = "\r";

/** Buffer used by most editor-level cases; `setText` leaves the cursor at the end. */
const TEXT = "one two\nthree two";

function flashEditor(text = TEXT): Editor {
	const editor = new Editor(defaultEditorTheme);
	editor.setText(text);
	editor.handleInput(FLASH);
	return editor;
}

function renderPlain(editor: Editor, width = 40): string[] {
	return editor.render(width).map(line => stripVTControlCharacters(line.replaceAll(CURSOR_MARKER, "")));
}

describe("Editor flash jump", () => {
	afterEach(() => {
		setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
	});

	describe("findMatches", () => {
		it("collects every occurrence across lines with exact columns", () => {
			const matches = findMatches(["one two", "three two"], "two", { line: 0, col: 0 });

			expect(matches).toEqual([
				{ line: 0, col: 4, end: 7 },
				{ line: 1, col: 6, end: 9 },
			]);
		});

		it("does not report overlapping occurrences", () => {
			expect(findMatches(["aaaa"], "aa", { line: 0, col: 0 })).toEqual([
				{ line: 0, col: 0, end: 2 },
				{ line: 0, col: 2, end: 4 },
			]);
		});

		it("matches case-insensitively while the query stays lowercase", () => {
			const matches = findMatches(["Alpha", "alpha"], "al", { line: 0, col: 0 });

			expect(matches.map(m => m.line)).toEqual([0, 1]);
		});

		it("matches case-sensitively once the query carries an uppercase character", () => {
			const matches = findMatches(["Alpha", "alpha"], "Al", { line: 0, col: 0 });

			expect(matches).toEqual([{ line: 0, col: 0, end: 2 }]);
		});

		it("orders matches nearest-to-cursor, preferring the forward direction on ties", () => {
			const matches = findMatches(["t a", "b t c", "d t"], "t", { line: 1, col: 3 });

			expect(matches.map(m => ({ line: m.line, col: m.col }))).toEqual([
				{ line: 1, col: 2 }, // same line
				{ line: 2, col: 2 }, // one line away, forward
				{ line: 0, col: 0 }, // one line away, backward
			]);
		});

		it("returns nothing for an empty query", () => {
			expect(findMatches(["anything"], "", { line: 0, col: 0 })).toEqual([]);
		});
	});

	describe("assignLabels", () => {
		it("drops every character that could extend the query from the alphabet", () => {
			const lines = ["ab", "ac"];
			const matches = findMatches(lines, "a", { line: 0, col: 0 });

			const pool = availableLabels(matches, lines);
			expect(pool).not.toContain("b");
			expect(pool).not.toContain("c");
			expect(pool.length).toBe(FLASH_LABEL_ALPHABET.length - 2);

			expect(assignLabels(matches, lines).map(m => m.label)).toEqual(["a", "s"]);
		});

		it("hands the first labels to the matches nearest the cursor", () => {
			const lines = ["t a", "b t c", "d t"];
			const labeled = assignLabels(findMatches(lines, "t", { line: 1, col: 3 }), lines);

			expect(labeled.map(m => [m.line, m.col, m.label])).toEqual([
				[1, 2, "a"],
				[2, 2, "s"],
				[0, 0, "d"],
			]);
		});

		it("leaves matches unlabeled once the alphabet runs out", () => {
			const lines = ["x", "x", "x"];
			const labeled = assignLabels(findMatches(lines, "x", { line: 0, col: 0 }), lines, "ab");

			expect(labeled.map(m => m.label)).toEqual(["a", "b", null]);
		});
	});

	describe("computeFlashState", () => {
		it("keeps an empty query label-free", () => {
			expect(computeFlashState(["one two"], { line: 0, col: 0 }, "")).toEqual({ query: "", matches: [] });
		});

		it("resolves a typed label back to its match", () => {
			const state = computeFlashState(["one two", "three two"], { line: 1, col: 9 }, "t");

			expect(findFlashLabel(state, "d")).toMatchObject({ line: 0, col: 4 });
			expect(findFlashLabel(state, "w")).toBeUndefined();
		});
	});

	describe("applyFlashSpans", () => {
		it("steps over ANSI escapes and the cursor marker instead of counting them", () => {
			const decorated = `\x1b[32mab${CURSOR_MARKER}cd\x1b[39m`;

			const out = applyFlashSpans(decorated, [
				{ start: 0, end: 2, priority: 0, style: styleFlashMatch },
				{ start: 2, end: 3, priority: 1, replaceWith: styleFlashLabel("k") },
			]);

			expect(out).toContain(CURSOR_MARKER);
			expect(out).toContain(styleFlashLabel("k"));
			expect(stripVTControlCharacters(out.replaceAll(CURSOR_MARKER, ""))).toBe("abkd");
		});

		it("lets a label claim a cell a lower-priority highlight also wants", () => {
			const out = applyFlashSpans("aaa", [
				{ start: 0, end: 1, priority: 0, style: styleFlashMatch },
				{ start: 1, end: 2, priority: 0, style: styleFlashMatch },
				{ start: 1, end: 2, priority: 1, replaceWith: styleFlashLabel("s") },
			]);

			expect(stripVTControlCharacters(out)).toBe("asa");
		});

		it("drops spans that start past the rendered text rather than clamping them", () => {
			expect(applyFlashSpans("ab", [{ start: 5, end: 5, priority: 1, replaceWith: styleFlashLabel("a") }])).toBe(
				"ab",
			);
		});
	});

	describe("entering and leaving the mode", () => {
		it("swallows typed characters instead of inserting them", () => {
			const editor = flashEditor();

			editor.handleInput("t");

			expect(editor.getText()).toBe(TEXT);
			expect(editor.getCursor()).toEqual({ line: 1, col: 9 });
		});

		it("leaves the caret alone on escape and resumes normal typing", () => {
			const editor = flashEditor();

			editor.handleInput("t");
			editor.handleInput(ESCAPE);
			editor.handleInput("z");

			expect(editor.getText()).toBe(`${TEXT}z`);
			expect(editor.getCursor()).toEqual({ line: 1, col: 10 });
		});

		it("exits when the trigger chord is pressed again", () => {
			const editor = flashEditor();

			editor.handleInput("t");
			editor.handleInput(FLASH);
			editor.handleInput("z");

			expect(editor.getText()).toBe(`${TEXT}z`);
		});

		it("exits on backspace with an empty query without deleting text", () => {
			const editor = flashEditor();

			editor.handleInput(BACKSPACE);
			expect(editor.getText()).toBe(TEXT);

			editor.handleInput("z");
			expect(editor.getText()).toBe(`${TEXT}z`);
		});

		it("exits on an unrelated control key and swallows it", () => {
			const editor = flashEditor();

			editor.handleInput("\x1b[D"); // Left arrow
			expect(editor.getCursor()).toEqual({ line: 1, col: 9 });

			editor.handleInput("\x1b[D");
			expect(editor.getCursor()).toEqual({ line: 1, col: 8 });
		});
	});

	describe("jumping", () => {
		it("moves the caret to the match a typed label points at", () => {
			const editor = flashEditor();

			editor.handleInput("t");
			editor.handleInput("d");

			expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
			expect(editor.getText()).toBe(TEXT);
		});

		it("takes the nearest match on Enter without submitting", () => {
			const editor = flashEditor();
			let submitted: string | undefined;
			editor.onSubmit = text => {
				submitted = text;
			};

			editor.handleInput("t");
			editor.handleInput(ENTER);

			expect(editor.getCursor()).toEqual({ line: 1, col: 6 });
			expect(submitted).toBeUndefined();
		});

		it("does nothing on Enter when the query matches nothing", () => {
			const editor = flashEditor();

			editor.handleInput("q");
			editor.handleInput(ENTER);

			expect(editor.getCursor()).toEqual({ line: 1, col: 9 });
			expect(editor.getText()).toBe(TEXT);
		});

		it("extends the query with a character that follows a match instead of jumping", () => {
			const editor = flashEditor();

			// "h" only ever follows a "t" match here, so it is excluded from the labels.
			editor.handleInput("t");
			editor.handleInput("h");
			editor.handleInput("a");

			expect(editor.getCursor()).toEqual({ line: 1, col: 0 });
		});

		it("re-labels as the query narrows and widens again", () => {
			const narrowed = flashEditor();
			narrowed.handleInput("t");
			narrowed.handleInput("w");
			narrowed.handleInput("s");
			expect(narrowed.getCursor()).toEqual({ line: 0, col: 4 });

			const widened = flashEditor();
			widened.handleInput("t");
			widened.handleInput("w");
			widened.handleInput(BACKSPACE);
			widened.handleInput("s");
			expect(widened.getCursor()).toEqual({ line: 1, col: 0 });
		});

		it("stays active on a zero-match query and recovers on backspace", () => {
			const editor = flashEditor();

			editor.handleInput("t");
			editor.handleInput("z"); // "tz" matches nothing
			expect(renderPlain(editor).join("\n")).toContain("three two");

			editor.handleInput(BACKSPACE);
			editor.handleInput("d");

			expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
			expect(editor.getText()).toBe(TEXT);
		});

		it("finds an uppercase occurrence from a lowercase query", () => {
			const editor = flashEditor("Alpha\nalpha");

			editor.handleInput("a");
			editor.handleInput("f");

			expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
		});
	});

	describe("rendering", () => {
		it("highlights matches and overlays labels without touching the buffer", () => {
			const editor = flashEditor();
			editor.handleInput("t");

			const raw = editor.render(40);
			expect(raw.join("\n")).toContain(styleFlashMatch("t"));
			expect(raw.join("\n")).toContain(styleFlashLabel("a"));

			// Labels replace the cell right after each match: "one two" -> "one tdo",
			// "three two" -> "tsree tao".
			const plain = renderPlain(editor).join("\n");
			expect(plain).toContain("one tdo");
			expect(plain).toContain("tsree tao");
			expect(editor.getText()).toBe(TEXT);
		});

		it("appends a label past the end of a line when the match ends it", () => {
			const editor = flashEditor("ab\ncd");
			editor.handleInput("b");

			const plain = renderPlain(editor);
			expect(plain.some(line => line.includes("aba"))).toBe(true);
			expect(editor.getText()).toBe("ab\ncd");
		});

		it("keeps every rendered row exactly the terminal width, wrapping included", () => {
			const editor = flashEditor("alpha bravo charlie delta echo foxtrot\nalpha again");
			editor.handleInput("a");

			for (const line of editor.render(20)) {
				expect(visibleWidth(line)).toBe(20);
			}
		});

		it("emits exactly one cursor marker while labels are on screen", () => {
			const editor = flashEditor();
			editor.focused = true;
			editor.handleInput("t");

			const rendered = editor.render(40).join("\n");
			expect(rendered.split(CURSOR_MARKER).length - 1).toBe(1);
		});

		it("dims the buffer the moment the mode engages, before anything is typed", () => {
			const editor = flashEditor();

			const raw = editor.render(40).join("\n");
			expect(raw).toContain(styleFlashBackdrop("one two"));
			expect(raw).toContain(styleFlashBackdrop("three two"));
			expect(raw).not.toContain(styleFlashLabel("a"));

			for (const line of editor.render(40)) {
				expect(visibleWidth(line)).toBe(40);
			}
		});

		it("keeps the backdrop between labels once a query narrows the matches", () => {
			const editor = flashEditor();
			editor.handleInput("t");

			// "one two": dim before the match, label over the "w", dim resumes after.
			const raw = editor.render(40).join("\n");
			expect(raw).toContain(styleFlashBackdrop("one "));
			expect(raw).toContain(styleFlashMatch("t"));
		});
		it("renders clean text again once the mode exits", () => {
			const editor = flashEditor();
			editor.handleInput("t");
			editor.handleInput(ESCAPE);

			const rendered = editor.render(40);
			expect(rendered.join("\n")).not.toContain(styleFlashLabel("a"));
			expect(rendered.join("\n")).not.toContain(styleFlashBackdrop("one two"));
			const plain = rendered.map(line => stripVTControlCharacters(line)).join("\n");
			expect(plain).toContain("one two");
			expect(plain).toContain("three two");
		});
	});
});
