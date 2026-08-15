import { useCallback, useRef, useState } from "react";

export type UndoEntry = {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
};

export function useUndoHistory(limit = 20) {
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const [version, setVersion] = useState(0);

  const push = useCallback((entry: UndoEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > limit) undoStack.current.shift();
    redoStack.current = [];
    setVersion((value) => value + 1);
  }, [limit]);

  const undo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    await entry.undo();
    redoStack.current.push(entry);
    setVersion((value) => value + 1);
  }, []);

  const redo = useCallback(async () => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    await entry.redo();
    undoStack.current.push(entry);
    setVersion((value) => value + 1);
  }, []);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setVersion((value) => value + 1);
  }, []);

  return { canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0, undo, redo, push, clear, version };
}