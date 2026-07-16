export interface ConfirmationState {
  readonly armed: boolean;
  readonly error: string | null;
}

export type ConfirmationEvent =
  | { readonly type: "arm" | "cancel" | "succeed" }
  | { readonly type: "fail"; readonly error: string };

export const INITIAL_CONFIRMATION_STATE: ConfirmationState = Object.freeze({
  armed: false,
  error: null,
});

export function transitionConfirmation(
  _state: ConfirmationState,
  event: ConfirmationEvent,
): ConfirmationState {
  if (event.type === "arm") return { armed: true, error: null };
  if (event.type === "fail") return { armed: true, error: event.error };
  return INITIAL_CONFIRMATION_STATE;
}
