import { useEffect, useMemo, useRef, useState } from "react";

export const MOTION_SEEN_ID_LIMIT = 500;

export function createResponseItemIdResolver(scope = "item") {
  const generatedIds = new WeakMap();
  let nextId = 0;
  return (items, getBackendId) => {
    const occurrences = new Map();
    return items.map((item, index) => {
      const backendId = getBackendId(item);
      let id;
      if (backendId !== null && backendId !== undefined && backendId !== "") id = `${scope}:server:${backendId}`;
      if (item && typeof item === "object") {
        if (!id) {
          id = generatedIds.get(item);
          if (!id) {
            id = `${scope}:response:${++nextId}:${index}`;
            generatedIds.set(item, id);
          }
        }
      }
      if (!id) id = `${scope}:primitive:${++nextId}:${index}`;
      const occurrence = occurrences.get(id) || 0;
      occurrences.set(id, occurrence + 1);
      return occurrence ? `${id}:occurrence:${occurrence}` : id;
    });
  };
}

// Results without a backend identity receive an immutable ID for the lifetime
// of that result object. WeakMap identity and a monotonic suffix make repeated
// values in one response distinct without retaining stale API payloads.
export function useStableResponseItemIds(items, getBackendId, scope = "item") {
  const resolver = useRef(null);
  if (!resolver.current) resolver.current = createResponseItemIdResolver(scope);
  return useMemo(() => resolver.current(items, getBackendId), [items, getBackendId]);
}

// IDs, rather than list position or refresh time, decide whether an item is new.
// The bounded LRU-like map prevents a long-lived polling session from growing
// memory indefinitely.
export function useNewItemMotion(ids, limit = MOTION_SEEN_ID_LIMIT) {
  const seenIds = useRef(new Map());
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const idsKey = ids.join("\u0001");

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const newIds = useMemo(
    () => new Set(ids.filter(Boolean).filter(id => !seenIds.current.has(id))),
    [idsKey]
  );

  useEffect(() => {
    ids.filter(Boolean).forEach(id => {
      seenIds.current.delete(id);
      seenIds.current.set(id, true);
    });
    while (seenIds.current.size > limit) seenIds.current.delete(seenIds.current.keys().next().value);
  }, [idsKey, limit]);

  return (id) => !reducedMotion && newIds.has(id);
}