import { darkVariant } from "@/lib/palette";

// Identity comes from the colored dot BESIDE the text; the text itself wears
// ink tokens, never the category color (light hues are illegible as text).
export function CategoryBadge({
  name,
  color,
}: {
  name: string | null;
  color: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={
          color
            ? ({
                backgroundColor: color,
                // dark-mode step of the same hue, swapped via media query
                "--dot-dark": darkVariant(color),
              } as React.CSSProperties)
            : { backgroundColor: "var(--ink-muted)" }
        }
        data-has-color={color ? "" : undefined}
      />
      {name ?? "Uncategorized"}
    </span>
  );
}
