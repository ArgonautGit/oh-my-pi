import { beforeAll, describe, expect, it, vi } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { CustomEditor } from "@oh-my-pi/pi-coding-agent/modes/components/custom-editor";
import { getEditorTheme, initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

describe("CustomEditor keybindings", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("routes the configured retry chord through handleInput", () => {
		const editor = new CustomEditor(getEditorTheme());
		const onRetry = vi.fn();

		editor.setActionKeys("app.retry", ["alt+shift+r"]);
		editor.onRetry = onRetry;
		editor.handleInput("\x1bR");

		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("routes the configured tool activity visibility chord through handleInput", () => {
		const editor = new CustomEditor(getEditorTheme());
		const onToggleToolActivity = vi.fn();

		editor.setActionKeys("app.tools.toggleVisibility", ["alt+h"]);
		editor.onToggleToolActivity = onToggleToolActivity;
		editor.handleInput("\x1bh");

		expect(onToggleToolActivity).toHaveBeenCalledTimes(1);
	});

	it("lets custom handlers keep precedence over the default retry chord", () => {
		const editor = new CustomEditor(getEditorTheme());
		const onRetry = vi.fn();
		const customHandler = vi.fn();

		editor.onRetry = onRetry;
		editor.setCustomKeyHandler("alt+r", customHandler);
		editor.handleInput("\x1br");

		expect(customHandler).toHaveBeenCalledTimes(1);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("lets copy-prompt remaps keep precedence over the default retry chord", () => {
		const editor = new CustomEditor(getEditorTheme());
		const onRetry = vi.fn();
		const onCopyPrompt = vi.fn();

		editor.onRetry = onRetry;
		editor.onCopyPrompt = onCopyPrompt;
		editor.setActionKeys("app.clipboard.copyPrompt", ["alt+r"]);
		editor.handleInput("\x1br");

		expect(onCopyPrompt).toHaveBeenCalledTimes(1);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("routes Ctrl+L to a live-toggle custom handler and Alt+L to display reset by default", () => {
		const editor = new CustomEditor(getEditorTheme());
		const onDisplayReset = vi.fn();
		const onLiveToggle = vi.fn();

		editor.onDisplayReset = onDisplayReset;
		editor.setCustomKeyHandler("ctrl+l", onLiveToggle);

		editor.handleInput("\x0c"); // Ctrl+L
		expect(onLiveToggle).toHaveBeenCalledTimes(1);
		expect(onDisplayReset).not.toHaveBeenCalled();

		editor.handleInput("\x1bl"); // Alt+L
		expect(onDisplayReset).toHaveBeenCalledTimes(1);
		expect(onLiveToggle).toHaveBeenCalledTimes(1);
	});

	it("stops app chords from stealing keys while the flash jump submode is active", () => {
		const editor = new CustomEditor(getEditorTheme());
		const onEscape = vi.fn();
		const onSelectModel = vi.fn();

		editor.onEscape = onEscape;
		editor.onSelectModel = onSelectModel;
		editor.setText("one two\nthree two");

		editor.handleInput("\x1bj"); // Alt+J enters flash mode
		expect(editor.isFlashActive()).toBe(true);

		// A query character is consumed by the submode, never inserted.
		editor.handleInput("t");
		expect(editor.getText()).toBe("one two\nthree two");

		// Escape belongs to the submode here, not to app.interrupt.
		editor.handleInput("\x1b");
		expect(editor.isFlashActive()).toBe(false);
		expect(onEscape).not.toHaveBeenCalled();

		// Any other app chord exits the submode and is swallowed rather than firing.
		editor.handleInput("\x1bj");
		editor.handleInput("t");
		editor.handleInput("\x1bm"); // Alt+M / app.model.select
		expect(editor.isFlashActive()).toBe(false);
		expect(onSelectModel).not.toHaveBeenCalled();

		// Once the submode is gone the same chords reach the app again.
		editor.handleInput("\x1b");
		editor.handleInput("\x1bm");
		expect(onEscape).toHaveBeenCalledTimes(1);
		expect(onSelectModel).toHaveBeenCalledTimes(1);
	});

	it("jumps the caret to a label typed through the app editor", () => {
		const editor = new CustomEditor(getEditorTheme());
		editor.setText("one two\nthree two");

		editor.handleInput("\x1bj");
		editor.handleInput("t");
		editor.handleInput("d");

		expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
		expect(editor.getText()).toBe("one two\nthree two");
	});
});

describe("shipped dequeue defaults", () => {
	it("binds both alt+up and shift+up to the steering dequeue", () => {
		const keybindings = KeybindingsManager.inMemory();
		const keys = keybindings.getKeys("app.message.dequeue");
		expect(keys).toContain("alt+up");
		expect(keys).toContain("shift+up");
	});
	it("does not steal shift+up from an explicit user binding", () => {
		const keybindings = KeybindingsManager.inMemory({
			"tui.editor.cursorUp": "shift+up",
		});

		expect(keybindings.getKeys("app.message.dequeue")).toEqual(["alt+up"]);
		expect(keybindings.getKeys("tui.editor.cursorUp")).toEqual(["shift+up"]);
	});
	it("routes the shipped shift+up default through DEFAULT_ACTION_KEYS to the dequeue handler", () => {
		// F12: the registry test above does not cover DEFAULT_ACTION_KEYS, the second
		// defaults table that custom-editor.ts seeds its match set from. Drive a real
		// editor without calling setActionKeys, so the shipped entry is the only thing
		// that can make the shift+up wire form (CSI 1;2A) reach onDequeue.
		const editor = new CustomEditor(getEditorTheme());
		const onDequeue = vi.fn();

		editor.onDequeue = onDequeue;
		editor.handleInput("\x1b[1;2A");

		expect(onDequeue).toHaveBeenCalledTimes(1);
	});
});
