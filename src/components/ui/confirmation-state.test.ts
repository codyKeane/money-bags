import { describe, expect, it } from "vitest";
import {
  INITIAL_CONFIRMATION_STATE,
  transitionConfirmation,
} from "./confirmation-state";

describe("confirmation state", () => {
  it("stays armed after a refusal and clears only on cancel or success", () => {
    const armed = transitionConfirmation(INITIAL_CONFIRMATION_STATE, { type: "arm" });
    const refused = transitionConfirmation(armed, {
      type: "fail",
      error: "Synthetic refusal",
    });
    expect(refused).toEqual({ armed: true, error: "Synthetic refusal" });
    expect(transitionConfirmation(refused, { type: "cancel" })).toBe(
      INITIAL_CONFIRMATION_STATE,
    );
    expect(transitionConfirmation(refused, { type: "succeed" })).toBe(
      INITIAL_CONFIRMATION_STATE,
    );
  });
});
