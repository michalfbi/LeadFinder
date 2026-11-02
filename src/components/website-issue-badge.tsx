import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Kolorowy badge z wynikiem audytora stron (lub „Brak strony WWW”). */
export function WebsiteIssueBadge({ issue, className }: { issue: string | null; className?: string }) {
  const t = issue ?? "";
  const tone = /wygas|błąd/i.test(t)
    ? "bg-destructive/20 text-destructive"
    : /ssl/i.test(t)
      ? "bg-warning/20 text-warning"
      : /mobiln/i.test(t)
        ? "bg-primary/20 text-primary"
        : "bg-muted text-muted-foreground";
  return (
    <Badge className={cn("rounded-full border-0 text-[10px]", tone, className)} title={issue ?? "Brak strony WWW"}>
      {issue ?? "Brak strony WWW"}
    </Badge>
  );
}
