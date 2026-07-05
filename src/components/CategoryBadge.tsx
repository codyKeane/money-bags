import { darkVariant } from "@/lib/palette";

// A small round color swatch for a category. The dark-mode step of the same
// hue is swapped in via the `--dot-dark` custom property + a media query in
// globals.css. Shared by CategoryBadge and CategoryManager (Q3).
export function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 rounded-full"
      style={
        color
          ? ({
              backgroundColor: color,
              "--dot-dark": darkVariant(color),
            } as React.CSSProperties)
          : { backgroundColor: "var(--ink-muted)" }
      }
      data-has-color={color ? "" : undefined}
    />
  );
}

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
      <ColorDot color={color} />
      {name ?? "Uncategorized"}
    </span>
  );
}
