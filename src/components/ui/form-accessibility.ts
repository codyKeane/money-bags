export interface FieldErrorAttributes {
  readonly "aria-invalid"?: true;
  readonly "aria-describedby"?: string;
}

export function fieldErrorAttributes(
  errorId: string,
  failingField: string | undefined,
  fieldName: string,
  existingDescriptionId?: string,
): FieldErrorAttributes {
  const matches = failingField === fieldName;
  const describedBy = [existingDescriptionId, matches ? errorId : undefined]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return {
    ...(matches ? { "aria-invalid": true as const } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  };
}

export function shouldFocusSubmittedFailure(
  wasPending: boolean,
  pending: boolean,
  failed: boolean,
): boolean {
  return wasPending && !pending && failed;
}
