import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WebsiteIssueBadge } from "@/components/website-issue-badge";
import { ISSUE_META, ISSUE_TYPES, issueTypeOf, type WebsiteIssueType } from "@/lib/issue-templates";
import { updateLead, type LeadRow } from "@/lib/leads-store";

/** Klikalny badge diagnozy — pozwala ręcznie zmienić typ problemu ze stroną. */
export function IssueTypePicker({
  type,
  onChange,
}: {
  type: WebsiteIssueType;
  onChange: (type: WebsiteIssueType) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="cursor-pointer rounded-full"
        onPointerDown={(e) => e.stopPropagation()}
        title="Zmień diagnozę strony"
      >
        <WebsiteIssueBadge issue={ISSUE_META[type].tag} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs">Diagnoza strony</DropdownMenuLabel>
        {ISSUE_TYPES.map((t) => (
          <DropdownMenuItem key={t} onSelect={() => onChange(t)} className={t === type ? "font-semibold" : ""}>
            {ISSUE_META[t].emoji} {ISSUE_META[t].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Wersja dla zapisanych leadów — od razu zapisuje zmianę w bazie. */
export function LeadIssuePicker({ lead }: { lead: LeadRow }) {
  const queryClient = useQueryClient();
  return (
    <IssueTypePicker
      type={issueTypeOf(lead)}
      onChange={async (t) => {
        try {
          await updateLead(lead.id, { website_issue_type: t, strona_problem: ISSUE_META[t].tag });
          queryClient.invalidateQueries({ queryKey: ["leads"] });
          toast.success(`Diagnoza: ${ISSUE_META[t].label}`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    />
  );
}
