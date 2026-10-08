import { getFearAndGreedRotationSnapshot } from "../../databus";
import type { RotationFearGreed, RotationSourceResult } from "../types";

export function createFearGreedSource() {
  return {
    async fetch(_date?: string): Promise<RotationSourceResult<RotationFearGreed>> {
      return getFearAndGreedRotationSnapshot();
    },
  };
}
