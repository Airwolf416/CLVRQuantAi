import { createContext } from "react";

// Shared without importing App (which would introduce a circular dependency).
export const ThemeCtx = createContext({ C: {}, isDark: true, toggle: () => {} });
