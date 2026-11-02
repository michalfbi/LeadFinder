import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_ISSUE_TEMPLATES,
  ISSUE_META,
  ISSUE_TYPES,
  issueTypeOf,
  useIssueTemplates,
  type WebsiteIssueType,
} from "@/lib/issue-templates";
import { listLeads } from "@/lib/leads-store";
import { countSpintaxCombinations, parseSpintax } from "@/lib/message-template";
import { cn } from "@/lib/utils";

const SAMPLE = { nazwa: "Stolarstwo Kowalski", miasto: "Kielce", branza: "stolarz" };

/** Edytor 4 szablonów SMS — po jednym na każdą diagnozę strony. */
export function IssueTemplatesEditor() {
  const { templates, save } = useIssueTemplates();
  const { data: leads } = useQuery({ queryKey: ["leads"], queryFn: listLeads });
  const [active, setActive] = useState<WebsiteIssueType>("NO_WEBSITE");
  const [drafts, setDrafts] = useState<Partial<Record<WebsiteIssueType, string>>>({});
  const [seed, setSeed] = useState(0);

  const value = drafts[active] ?? templates[active];
  const counts = useMemo(() => {
    const c: Record<WebsiteIssueType, number> = { NO_WEBSITE: 0, EXPIRED_OR_ERROR: 0, NO_SSL: 0, NO_MOBILE: 0, OLX_NO_WEBSITE: 0 };
    for (const l of leads ?? []) c[issueTypeOf(l)]++;
    return c;
  }, [leads]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const preview = useMemo(() => parseSpintax(value, SAMPLE), [value, seed]);
  const combos = countSpintaxCombinations(value);
  const dirty = drafts[active] !== undefined && drafts[active] !== templates[active];

  const insert = (token: string) =>
    setDrafts((d) => ({ ...d, [active]: `${value}${value.endsWith(" ") ? "" : " "}${token}` }));

  return (
    <Card className="glass rounded-3xl border-0 shadow-none lg:col-span-2">
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="text-base font-semibold">Inteligentny ruter szablonów SMS</h2>
          <p className="text-sm text-muted-foreground">
            Przy masowej wysyłce każdy lead dostaje szablon dopasowany do problemu z jego stroną.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {ISSUE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActive(t)}
              className={cn(
                "rounded-2xl border p-3 text-left text-sm transition-colors",
                t === active ? "border-primary bg-primary/10" : "border-border/60 bg-background/40 hover:bg-background/60",
              )}
            >
              <span className="block font-medium">
                {ISSUE_META[t].emoji} {ISSUE_META[t].label}
              </span>
              <span className="text-xs text-muted-foreground">{counts[t]} leadów</span>
            </button>
          ))}
        </div>

        <Textarea
          value={value}
          onChange={(e) => setDrafts((d) => ({ ...d, [active]: e.target.value }))}
          className="min-h-36 rounded-2xl"
          aria-label={`Szablon: ${ISSUE_META[active].label}`}
        />
        <div className="flex flex-wrap gap-2">
          {["{nazwa}", "{miasto}", "{branza}"].map((t) => (
            <Button key={t} variant="outline" size="sm" className="rounded-xl" onClick={() => insert(t)}>
              {t}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl"
            onClick={() => setDrafts((d) => ({ ...d, [active]: DEFAULT_ISSUE_TEMPLATES[active] }))}
          >
            Przywróć domyślny
          </Button>
          <Button
            size="sm"
            className="ml-auto rounded-xl"
            disabled={!dirty}
            onClick={() => {
              save(active, value);
              setDrafts((d) => ({ ...d, [active]: undefined }));
              toast.success(`Zapisano szablon „${ISSUE_META[active].label}”`);
            }}
          >
            Zapisz szablon
          </Button>
        </div>

        <div className="space-y-2 rounded-2xl border border-border/60 bg-background/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Podgląd losowego wariantu · {combos.toLocaleString("pl-PL")} unikalnych kombinacji
            </span>
            <Button variant="ghost" size="sm" className="h-7 rounded-lg text-xs" onClick={() => setSeed((s) => s + 1)}>
              Losuj ponownie
            </Button>
          </div>
          <p>{preview}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          W Twojej bazie znajduje się obecnie {counts[active]} leadów pasujących do tego szablonu.
        </p>
      </CardContent>
    </Card>
  );
}
