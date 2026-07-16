export const ADD_TRANSACTION_FOCUS_ID = "add-transaction-toggle";
export const NEW_CATEGORY_FOCUS_ID = "new-category-toggle";
export const NEW_ACCOUNT_FOCUS_ID = "new-account-toggle";
export const RECENT_IMPORTS_FOCUS_ID = "recent-imports-heading";

interface FocusableElement {
  focus(): void;
}

interface FocusDocument {
  getElementById(id: string): FocusableElement | null;
}

export function focusElementById(id: string, documentLike: FocusDocument): boolean {
  const target = documentLike.getElementById(id);
  if (target === null) return false;
  target.focus();
  return true;
}
