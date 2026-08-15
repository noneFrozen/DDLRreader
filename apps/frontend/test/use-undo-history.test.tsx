import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUndoHistory } from "../src/features/plan/useUndoHistory.js";

describe("useUndoHistory", () => {
  it("undoes and redoes pushed entries in order", async () => {
    const { result } = renderHook(() => useUndoHistory());
    const order: string[] = [];

    act(() => result.current.push({ label: "a", undo: () => { order.push("undo-a"); }, redo: () => { order.push("redo-a"); } }));
    act(() => result.current.push({ label: "b", undo: () => { order.push("undo-b"); }, redo: () => { order.push("redo-b"); } }));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    await act(async () => { await result.current.undo(); });
    expect(order).toEqual(["undo-b"]);
    expect(result.current.canRedo).toBe(true);

    await act(async () => { await result.current.redo(); });
    expect(order).toEqual(["undo-b", "redo-b"]);

    await act(async () => { await result.current.undo(); });
    expect(order).toEqual(["undo-b", "redo-b", "undo-b"]);
  });

  it("clears the redo stack when a new entry is pushed", () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => result.current.push({ label: "a", undo: () => undefined, redo: () => undefined }));
    act(() => result.current.undo());
    act(() => result.current.push({ label: "c", undo: () => undefined, redo: () => undefined }));
    expect(result.current.canRedo).toBe(false);
  });
});