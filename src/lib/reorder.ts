// Shared helper for the drag-and-drop / ▲▼ reordering UI in ExamDetailPage
// (tasks) and TaskEditorPage (test cases) — both lists are teacher-authored,
// small (a handful to a few dozen rows), and persisted by sending one PATCH
// per row with its new `order` after a move (no bulk-reorder endpoint exists
// server-side; `order` has no uniqueness constraint in the schema, so
// transiently-overlapping values from these requests landing out of order
// are harmless — see schema.prisma).

// Returns a new array with the item at `from` moved to `to` (both plain
// array indices, not `order` values) — does not mutate `items`.
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// After a reorder, only the rows whose 0-based position actually changed vs.
// their previous `order` value need a PATCH — this pairs each item with its
// new order and filters to just those, so e.g. moving the last item to first
// doesn't send an unnecessary PATCH for the untouched middle of a long list.
export function changedOrders<T extends { order: number }>(
  items: T[],
): { item: T; order: number }[] {
  return items
    .map((item, order) => ({ item, order }))
    .filter(({ item, order }) => item.order !== order);
}
